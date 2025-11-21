// src/engine.ts

import { Notice, TFile, TFolder, normalizePath, App } from "obsidian";
import KnowledgeGraphPlugin from "./main";
import { APIHandler, AllModelsFailedError } from "./apiHandler";
import { Critic } from "./critic";
import { Reviser } from "./reviser";
import { sanitizeFilename, extractNewIdeas, cleanMarkdownOutput, Logger } from "./utils";
import { TaskData } from "./types";

export class Engine {
    plugin: KnowledgeGraphPlugin;
    app: App;
    apiHandler: APIHandler;
    critic: Critic;
    reviser: Reviser;
    private isRunning: boolean = false;
    private timerId: NodeJS.Timeout | null = null;

    constructor(plugin: KnowledgeGraphPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.apiHandler = new APIHandler(plugin);
        this.critic = new Critic(plugin);
        this.reviser = new Reviser(plugin);
    }

    // --- Public Controls ---
    public toggleEngineState(): void {
        if (this.isRunning) {
            this.stop();
        } else {
            this.start();
        }
    }

    public addConceptToQueue(concept: string): boolean {
        const added = this.addConceptsToQueue([concept]);
        if (added > 0) {
            new Notice(`'${concept}' added to queue.`);
            this.updateStatusBar();
            return true;
        }
        new Notice(`'${concept}' already exists or queued.`);
        return false;
    }

    public addConceptsToQueue(concepts: string[]): number {
        const currentQueue = new Set(this.plugin.data.generationQueue);
        const existingFiles = new Set(this.app.vault.getMarkdownFiles().map(f => f.basename));

        let addedCount = 0;
        for (const concept of concepts) {
            const sanitized = sanitizeFilename(concept);
            if (!currentQueue.has(concept) && !existingFiles.has(sanitized)) {
                this.plugin.data.generationQueue.push(concept);
                currentQueue.add(concept); 
                addedCount++;
            }
        }

        if (addedCount > 0) {
            void this.plugin.savePluginData(); 
            this.updateStatusBar();
        }
        return addedCount;
    }

    // --- Core Loop ---
    
    private start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.plugin.data.status = "running";
        new Notice("Knowledge graph engine started!");
        this.updateStatusBar();
        
        this.tick().catch(error => {
            Logger.error("Tick error during start:", error);
            this.stop();
        });
    }

    private stop(): void {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.plugin.data.status = "paused";
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        new Notice("Knowledge graph engine paused.");
        this.updateStatusBar();
        void this.plugin.savePluginData(); 
    }

    private scheduleNextTick(): void {
        if (!this.isRunning) return;
        const delay = this.plugin.settings.request_delay * 1000;
        this.timerId = setTimeout(() => {
            this.tick().catch(error => {
                Logger.error("Tick error:", error);
            });
        }, delay);
    }

    private async tick(): Promise<void> {
        if (!this.isRunning) return;

        try {
            let taskProcessed = false;

            if (this.plugin.data.revisionQueue.length > 0) {
                taskProcessed = await this.runRevisionPhase();
            } 
            else if (this.plugin.data.reviewQueue.length > 0) {
                taskProcessed = await this.runCriticPhase();
            } 
            else if (this.plugin.data.generationQueue.length > 0) {
                taskProcessed = await this.runGenerationPhase();
            }

            if (!taskProcessed &&
                this.plugin.data.generationQueue.length === 0 &&
                this.plugin.data.reviewQueue.length === 0 &&
                this.plugin.data.revisionQueue.length === 0) {
                
                new Notice("🎉 All tasks completed! Engine stopped.");
                this.isRunning = false;
                this.plugin.data.status = "idle"; 
                this.updateStatusBar();
                await this.plugin.savePluginData(); 
                return; 
            }

        } catch (error) {
            Logger.error("Engine fatal error:", error);
            new Notice("Engine encountered an error and paused. Check console.");
            this.stop(); 
            return;
        }

        this.scheduleNextTick();
    }

    // --- Phases ---
    private async runGenerationPhase(): Promise<boolean> {
        const queue = this.plugin.data.generationQueue;
        if (queue.length === 0) return false;

        const batchSize = this.plugin.settings.generation_batch_size;
        const batch = queue.splice(0, Math.min(queue.length, batchSize));

        this.updateStatusBar();
        await this.plugin.savePluginData(); 

        const tasks = batch.map(idea => this.generationTask(idea));
        await Promise.allSettled(tasks);

        await this.plugin.savePluginData(); 
        return true;
    }

    private async generationTask(idea: string): Promise<void> {
        const prompt = this.plugin.settings.prompt_generator.replace("{concept}", idea);
        try {
            const content = await this.apiHandler.call(prompt);
            const cleanedContent = cleanMarkdownOutput(content);
            
            // 【修改】保存内容到缓存文件，而不是仅保留在内存
            await this.plugin.persistence.saveTaskContent(idea, cleanedContent);
            
            // 队列中只保存元数据，content 可选
            this.plugin.data.reviewQueue.push({ idea, content: cleanedContent });
            Logger.log(`✅ [Generation Success]: ${idea}`);
        } catch (e) {
            if (e instanceof AllModelsFailedError) {
                Logger.error(`❌ [Generation Failed]: ${idea} - ${e.message}`);
                this.plugin.data.generationQueue.unshift(idea); 
            }
        }
    }

    private async runCriticPhase(): Promise<boolean> {
        const queue = this.plugin.data.reviewQueue;
        if (queue.length === 0) return false;

        const batchSize = this.plugin.settings.generation_batch_size;
        const tasksToReview = queue.splice(0, Math.min(queue.length, batchSize));

        this.updateStatusBar();
        await this.plugin.savePluginData(); 

        let newIdeasFound: Set<string> = new Set();

        for (const task of tasksToReview) {
            // 【修改】如果内存中没有内容（刚加载），从文件加载
            let content = task.content;
            if (!content) {
                content = await this.plugin.persistence.loadTaskContent(task.idea);
            }

            if (!content) {
                Logger.error(`❌ [Critic Error]: Content not found for ${task.idea}. Discarding.`);
                this.plugin.data.discardedPile.push({ ...task, reason: "Content file lost" });
                continue;
            }

            const { isApproved, reason } = await this.critic.judge(content);
            if (isApproved) {
                await this.saveNote(task.idea, content);
                // 【修改】批准后，清理缓存文件
                await this.plugin.persistence.deleteTaskContent(task.idea);
                
                if (this.plugin.settings.extract_new_concepts) {
                    const ideas = extractNewIdeas(content);
                    ideas.forEach(idea => newIdeasFound.add(idea));
                }

                Logger.log(`👍 [Approved]: ${task.idea}`);
            } else {
                task.reason = reason;
                task.retries = (task.retries || 0) + 1;
                // 拒绝后，内容依然保存在缓存中，无需重新保存，只需移动队列
                this.plugin.data.revisionQueue.push(task);
                Logger.warn(`👎 [Rejected]: ${task.idea} - ${reason}`);
            }
        }

        if (newIdeasFound.size > 0) {
            this.addConceptsToQueue(Array.from(newIdeasFound));
        }

        await this.plugin.savePluginData(); 
        return true;
    }

    private async runRevisionPhase(): Promise<boolean> {
        const queue = this.plugin.data.revisionQueue;
        if (queue.length === 0) return false;

        const batchSize = this.plugin.settings.generation_batch_size;
        const tasksToRevise = queue.splice(0, Math.min(queue.length, batchSize));

        this.updateStatusBar();
        await this.plugin.savePluginData(); 

        for (const task of tasksToRevise) {
            if ((task.retries || 0) >= this.plugin.settings.max_revision_retries) {
                this.plugin.data.discardedPile.push(task); 
                // 【修改】彻底丢弃时，是否删除缓存？目前保留以便手动重试，或者您可以选择删除
                // await this.plugin.persistence.deleteTaskContent(task.idea); 
                Logger.error(`💀 [Give up]: ${task.idea} max retries reached.`);
                continue; 
            }
            await this.revisionTask(task);
        }

        await this.plugin.savePluginData(); 
        return true;
    }

    private async revisionTask(task: TaskData): Promise<void> {
        // 【修改】确保有内容
        let content = task.content;
        if (!content) {
            content = await this.plugin.persistence.loadTaskContent(task.idea);
        }
        if (!content) {
             Logger.error(`Content missing for revision: ${task.idea}`);
             this.plugin.data.discardedPile.push(task);
             return;
        }

        const prompt = this.reviser.createRevisionPrompt(task.idea, content, task.reason || "unknown");
        try {
            const newContent = await this.apiHandler.call(prompt);
            const cleanedContent = cleanMarkdownOutput(newContent);
            
            // 【修改】更新缓存文件
            await this.plugin.persistence.saveTaskContent(task.idea, cleanedContent);

            const revisedTask: TaskData = { ...task, content: cleanedContent };
            this.plugin.data.reviewQueue.push(revisedTask); 
            Logger.log(`🔄 [Revision Complete]: ${task.idea}`);
        } catch (e: unknown) { // Fixed: unknown
            const errMsg = e instanceof Error ? e.message : String(e);
            Logger.error(`❌ [Revision Failed]: ${task.idea} - ${errMsg}`);
            this.plugin.data.revisionQueue.unshift(task); 
        }
    }

    // --- File & UI ---
    private async saveNote(idea: string, content: string): Promise<void> {
        const filename = sanitizeFilename(idea);
        const folderPath = this.plugin.settings.output_dir;

        if (!(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
            try {
                await this.app.vault.createFolder(folderPath);
            } catch (error) {
                Logger.error(`Create folder failed: ${folderPath}`, error);
                new Notice(`Cannot create folder: ${folderPath}`);
                return; 
            }
        }
        
        const filePath = normalizePath(`${folderPath}/${filename}.md`);
        const file = this.app.vault.getAbstractFileByPath(filePath);

        try {
            if (file instanceof TFile) {
                await this.app.vault.modify(file, content);
                new Notice(`Note updated: ${filename}`);
            } else {
                await this.app.vault.create(filePath, content);
                new Notice(`Note created: ${filename}`);
            }
        } catch (error) {
            Logger.error(`Save note failed: ${filePath}`, error);
            new Notice(`Cannot save note: ${filename}`);
        }
    }

    public updateStatusBar(): void {
        if (!this.plugin.statusBarEl) return;
        const { generationQueue, reviewQueue, revisionQueue } = this.plugin.data;
        const total = generationQueue.length + reviewQueue.length + revisionQueue.length;
        
        this.plugin.statusBarEl.setText(
            `KG: ${this.plugin.data.status} | G:${generationQueue.length} | C:${reviewQueue.length} | R:${revisionQueue.length} | Total:${total}`
        );
        
        this.app.workspace.trigger("kg-data-updated");
    }
}