// src/engine.ts

import { Notice, TFile, TFolder, normalizePath, App } from "obsidian";
import KnowledgeGraphPlugin from "./main";
import { APIHandler, AllModelsFailedError } from "./apiHandler";
import { Critic } from "./critic";
import { Reviser } from "./reviser";
import { sanitizeFilename, extractNewIdeas, cleanMarkdownOutput } from "./utils";
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
            this.plugin.savePluginData(); 
            this.updateStatusBar();
        }
        return addedCount;
    }

    // --- Core Loop ---
    
    // 修改：去除 async，处理 tick 的 promise
    private start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.plugin.data.status = "running";
        new Notice("Knowledge Graph Engine started!");
        this.updateStatusBar();
        
        // 显式处理 promise
        this.tick().catch(error => {
            console.error("Tick error during start:", error);
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
        new Notice("Knowledge Graph Engine paused.");
        this.updateStatusBar();
        this.plugin.savePluginData(); 
    }

    private scheduleNextTick(): void {
        if (!this.isRunning) return;
        const delay = this.plugin.settings.request_delay * 1000;
        this.timerId = setTimeout(() => {
            this.tick().catch(error => {
                console.error("Tick error:", error);
                // 遇到严重错误可以选择停止或继续，这里仅记录
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
            console.error("Engine fatal error:", error);
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
            this.plugin.data.reviewQueue.push({ idea, content: cleanedContent });
            // 修改：console.log -> console.debug
            console.debug(`✅ [Generation Success]: ${idea}`);
        } catch (e) {
            if (e instanceof AllModelsFailedError) {
                console.error(`❌ [Generation Failed]: ${idea} - ${e.message}`);
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
            const { isApproved, reason } = await this.critic.judge(task.content);
            if (isApproved) {
                await this.saveNote(task.idea, task.content);
                
                if (this.plugin.settings.extract_new_concepts) {
                    const ideas = extractNewIdeas(task.content);
                    ideas.forEach(idea => newIdeasFound.add(idea));
                }

                // 修改：console.log -> console.debug
                console.debug(`👍 [Approved]: ${task.idea}`);
            } else {
                task.reason = reason;
                task.retries = (task.retries || 0) + 1;
                this.plugin.data.revisionQueue.push(task);
                console.warn(`👎 [Rejected]: ${task.idea} - ${reason}`);
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
                console.error(`💀 [Give up]: ${task.idea} max retries reached.`);
                continue; 
            }
            await this.revisionTask(task);
        }

        await this.plugin.savePluginData(); 
        return true;
    }

    private async revisionTask(task: TaskData): Promise<void> {
        const prompt = this.reviser.createRevisionPrompt(task.idea, task.content, task.reason || "unknown");
        try {
            const newContent = await this.apiHandler.call(prompt);
            const cleanedContent = cleanMarkdownOutput(newContent);
            const revisedTask: TaskData = { ...task, content: cleanedContent };
            this.plugin.data.reviewQueue.push(revisedTask); 
            // 修改：console.log -> console.debug
            console.debug(`🔄 [Revision Complete]: ${task.idea}`);
        } catch (e: any) {
             // 修改：e is unknown/any -> 使用 any 暂时规避，或 (e as Error).message
            console.error(`❌ [Revision Failed]: ${task.idea} - ${e?.message}`);
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
                console.error(`Create folder failed: ${folderPath}`, error);
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
            console.error(`Save note failed: ${filePath}`, error);
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