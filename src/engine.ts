// src/engine.ts

import { Notice, TFile, TFolder, normalizePath, App } from "obsidian";
// 【修正 1】使用默认导入，防止 named export 兼容性问题
import Pinyin from 'tiny-pinyin'; 
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
    
    private activeGenerations: Map<string, number> = new Map();
    private readonly TASK_TIMEOUT_MS = 5 * 60 * 1000; 

    constructor(plugin: KnowledgeGraphPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.apiHandler = new APIHandler(plugin);
        this.critic = new Critic(plugin);
        this.reviser = new Reviser(plugin);
    }

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
        
        if (this.activeGenerations.has(concept)) {
             new Notice(`'${concept}' is currently being generated.`);
             return false;
        }
        new Notice(`'${concept}' already exists or queued.`);
        return false;
    }

    public addConceptsToQueue(concepts: string[]): number {
        const currentQueue = new Set(this.plugin.data.generationQueue);
        
        let addedCount = 0;
        for (const concept of concepts) {
            const sanitized = sanitizeFilename(concept);
            const existingFile = this.app.metadataCache.getFirstLinkpathDest(sanitized, "");

            if (!currentQueue.has(concept) && 
                !existingFile && 
                !this.activeGenerations.has(concept)) {
                
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

    private cleanupZombieTasks() {
        const now = Date.now();
        for (const [idea, startTime] of this.activeGenerations.entries()) {
            if (now - startTime > this.TASK_TIMEOUT_MS) {
                Logger.warn(`🧹 [Zombie Sweeper]: Removing stuck task '${idea}' after ${this.TASK_TIMEOUT_MS / 1000}s.`);
                this.activeGenerations.delete(idea);
            }
        }
    }

    private async tick(): Promise<void> {
        if (!this.isRunning) return;

        try {
            this.cleanupZombieTasks();
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
                
                if (this.activeGenerations.size === 0) {
                    new Notice("🎉 All tasks completed! Engine stopped.");
                    this.isRunning = false;
                    this.plugin.data.status = "idle"; 
                    this.updateStatusBar();
                    await this.plugin.savePluginData(); 
                    return; 
                }
            }

        } catch (error) {
            Logger.error("Engine fatal error:", error);
            // 打印完整的错误堆栈，方便调试
            console.error(error); 
            new Notice("Engine encountered an error and paused. Check console.");
            this.stop(); 
            return;
        }

        this.scheduleNextTick();
    }
    
    private async runGenerationPhase(): Promise<boolean> {
        const queue = this.plugin.data.generationQueue;
        if (queue.length === 0) return false;

        const maxConcurrency = this.plugin.settings.generation_batch_size;
        const currentActive = this.activeGenerations.size;
        const slotsAvailable = maxConcurrency - currentActive;

        if (slotsAvailable <= 0) return false;

        const candidates = queue.filter(idea => !this.activeGenerations.has(idea));
        if (candidates.length === 0) return false;

        const batch = candidates.slice(0, slotsAvailable);
        batch.forEach(idea => this.activeGenerations.set(idea, Date.now()));
        
        this.updateStatusBar();
        await this.plugin.savePluginData();

        batch.forEach(idea => {
            this.generationTask(idea).catch(err => {
                Logger.error(`Unhandled error in background generation task for ${idea}:`, err);
                this.activeGenerations.delete(idea);
            });
        });

        return true;
    }

    private async generationTask(idea: string): Promise<void> {
        const prompt = this.plugin.settings.prompt_generator.replace("{concept}", idea);
        try {
            const content = await this.apiHandler.call(prompt);
            const cleanedContent = cleanMarkdownOutput(content);
            
            await this.plugin.persistence.saveTaskContent(idea, cleanedContent);
            this.plugin.data.reviewQueue.push({ idea, content: cleanedContent });
            
            const qIndex = this.plugin.data.generationQueue.indexOf(idea);
            if (qIndex > -1) {
                this.plugin.data.generationQueue.splice(qIndex, 1);
            }

            Logger.log(`✅ [Generation Success]: ${idea}`);
        } catch (e) {
            if (e instanceof AllModelsFailedError) {
                Logger.error(`❌ [Generation Failed]: ${idea} - ${e.message}`);
                new Notice(`🛑 Engine paused: All models failed for '${idea}'. Check settings.`);
                this.stop();
            } else {
                Logger.error(`⚠️ [Generation Error]: ${idea} - ${e}`);
            }
        } finally {
            this.activeGenerations.delete(idea);
            void this.plugin.savePluginData();
            this.updateStatusBar();
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
                // 【保存文件时可能会出错，所以这里是重点】
                await this.saveNote(task.idea, content);
                await this.plugin.persistence.deleteTaskContent(task.idea);
                
                if (this.plugin.settings.extract_new_concepts) {
                    const ideas = extractNewIdeas(content);
                    ideas.forEach(idea => newIdeasFound.add(idea));
                }

                Logger.log(`👍 [Approved]: ${task.idea}`);
            } else {
                task.reason = reason;
                task.retries = (task.retries || 0) + 1;
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
                Logger.error(`💀 [Give up]: ${task.idea} max retries reached.`);
                continue; 
            }
            await this.revisionTask(task);
        }

        await this.plugin.savePluginData(); 
        return true;
    }

    private async revisionTask(task: TaskData): Promise<void> {
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
            
            await this.plugin.persistence.saveTaskContent(task.idea, cleanedContent);

            const revisedTask: TaskData = { ...task, content: cleanedContent };
            this.plugin.data.reviewQueue.push(revisedTask); 
            Logger.log(`🔄 [Revision Complete]: ${task.idea}`);
        } catch (e: unknown) { 
            const errMsg = e instanceof Error ? e.message : String(e);
            Logger.error(`❌ [Revision Failed]: ${task.idea} - ${errMsg}`);
            
            this.plugin.data.revisionQueue.unshift(task); 

            if (e instanceof AllModelsFailedError) {
                new Notice("🛑 Engine paused: All models failed during revision.");
                this.stop();
            }
        }
    }

    private async ensureFolderExists(folderPath: string): Promise<void> {
        const normalizedPath = normalizePath(folderPath);
        const folders = normalizedPath.split("/");
        let currentPath = "";

        for (const folder of folders) {
            currentPath = currentPath === "" ? folder : `${currentPath}/${folder}`;
            const existing = this.app.vault.getAbstractFileByPath(currentPath);
            if (!existing) {
                try {
                    await this.app.vault.createFolder(currentPath);
                } catch (error) {
                    Logger.warn(`Folder check/create: ${currentPath}`, error);
                }
            } else if (!(existing instanceof TFolder)) {
                Logger.error(`Path conflict: ${currentPath} exists but is not a folder.`);
                throw new Error(`Cannot create folder "${currentPath}" because a file exists with the same name.`);
            }
        }
    }

    private async saveNote(idea: string, content: string): Promise<void> {
        const filename = sanitizeFilename(idea);
        const baseDir = this.plugin.settings.output_dir;
        
        // 【修正】使用 tiny-pinyin 的正确姿势
        let subFolder = "0-9_Others";
        const cleanName = filename.replace(/[\[\]]/g, '').trim();
        const firstChar = cleanName.charAt(0);

        // 1. 英文
        if (/^[a-zA-Z]/.test(firstChar)) {
            subFolder = firstChar.toUpperCase();
        } 
        // 2. 中文 (修正后的逻辑)
        else if (Pinyin.isSupported(firstChar)) {
            try {
                // Pinyin.parse 返回数组，如 [{source: '中', type: 2, target: 'ZHONG'}]
                const tokens = Pinyin.parse(firstChar);
                if (tokens && tokens.length > 0 && tokens[0].target) {
                    const pinyinStr = tokens[0].target; // 例如 "ZHONG"
                    const pinyinLetter = pinyinStr.charAt(0).toUpperCase(); // 取 "Z"
                    
                    if (/^[A-Z]/.test(pinyinLetter)) {
                        subFolder = pinyinLetter;
                    }
                }
            } catch (err) {
                Logger.warn(`Pinyin parse error for ${firstChar}:`, err);
                // 出错则降级到 "CN_Chinese" 或 "Others"
                subFolder = "CN_Chinese";
            }
        }
        
        const folderPath = `${baseDir}/${subFolder}`;

        try {
            await this.ensureFolderExists(folderPath);
        } catch (error) {
            Logger.error(`Create folder failed: ${folderPath}`, error);
            new Notice(`Cannot create folder: ${folderPath}`);
            return; 
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