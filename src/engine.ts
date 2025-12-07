// src/engine.ts

import { Notice, TFile, TFolder, normalizePath, App, debounce } from "obsidian";
import Pinyin from 'tiny-pinyin'; 
import KnowledgeGraphPlugin from "./main";
import { APIHandler, AllModelsFailedError } from "./apiHandler";
import { Critic } from "./critic";
import { Reviser } from "./reviser";
import { sanitizeFilename, extractNewIdeas, cleanMarkdownOutput, Logger } from "./utils";
import { TaskData } from "./types";

// 【优化点1】任务状态管理器
class TaskManager {
    private activeGenerations = new Map<string, number>(); // idea -> startTime
    private zombieRetryCounts = new Map<string, number>(); // idea -> count
    
    private readonly TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    private readonly MAX_ZOMBIE_RETRIES = 3;

    addActiveTask(idea: string): boolean {
        if (this.activeGenerations.has(idea)) {
            return false; // Already running
        }
        this.activeGenerations.set(idea, Date.now());
        return true;
    }

    removeActiveTask(idea: string): void {
        this.activeGenerations.delete(idea);
    }

    cleanupZombies(): { toRetry: string[], toDiscard: TaskData[] } {
        const now = Date.now();
        const toRetry: string[] = [];
        const toDiscard: TaskData[] = [];

        for (const [idea, startTime] of this.activeGenerations.entries()) {
            if (now - startTime > this.TASK_TIMEOUT_MS) {
                this.activeGenerations.delete(idea);
                
                const retries = this.zombieRetryCounts.get(idea) || 0;
                if (retries >= this.MAX_ZOMBIE_RETRIES) {
                    Logger.error(`💀 [Zombie Killer]: Task '${idea}' failed ${retries} times (timeout). Giving up.`);
                    toDiscard.push({ idea, reason: "Timeout loops (Zombie)" });
                    this.zombieRetryCounts.delete(idea);
                } else {
                    Logger.warn(`🧹 [Zombie Sweeper]: Task '${idea}' timed out. Re-queuing (Attempt ${retries + 1}/${this.MAX_ZOMBIE_RETRIES}).`);
                    toRetry.push(idea);
                    this.zombieRetryCounts.set(idea, retries + 1);
                }
            }
        }
        return { toRetry, toDiscard };
    }

    clearRetryCount(idea: string): void {
        this.zombieRetryCounts.delete(idea);
    }

    get activeCount(): number {
        return this.activeGenerations.size;
    }
}

export class Engine {
    plugin: KnowledgeGraphPlugin;
    app: App;
    apiHandler: APIHandler;
    critic: Critic;
    reviser: Reviser;
    private taskManager: TaskManager;
    
    private isRunning: boolean = false;
    private timerId: NodeJS.Timeout | null = null;
    
    // 【优化点2】使用 debounce 包装数据保存，防止高频写入
    private debouncedSavePluginData: () => Promise<void>;

    constructor(plugin: KnowledgeGraphPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.apiHandler = new APIHandler(plugin);
        this.critic = new Critic(plugin);
        this.reviser = new Reviser(plugin);
        this.taskManager = new TaskManager();

        // 初始化 debounced saver
        this.debouncedSavePluginData = debounce(this._savePluginData.bind(this), 2000, true);
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
        
        if (this.taskManager.activeGenerations.has(concept)) {
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
                !this.taskManager.activeGenerations.has(concept)) {
                
                this.plugin.data.generationQueue.push(concept);
                currentQueue.add(concept); 
                addedCount++;
            }
        }

        if (addedCount > 0) {
            this.debouncedSavePluginData();
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
        this.scheduleNextTick();
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
        // 立即保存一次状态
        void this._savePluginData();
    }

    private scheduleNextTick(): void {
        if (!this.isRunning) return;
        const delay = this.plugin.settings.request_delay * 1000;
        this.timerId = setTimeout(() => {
            this.tick().catch(error => {
                Logger.error("Tick error (recovered):", error);
                // 即使 tick 出错，也要尝试调度下一次，除非引擎已停止
                if (this.isRunning) this.scheduleNextTick();
            });
        }, delay);
    }

    private async tick(): Promise<void> {
        if (!this.isRunning) return;

        let taskProcessed = false;

        // 1. 清理僵尸任务
        const { toRetry, toDiscard } = this.taskManager.cleanupZombies();
        if (toDiscard.length > 0) {
            this.plugin.data.discardedPile.push(...toDiscard);
            taskProcessed = true;
        }
        if (toRetry.length > 0) {
            this.plugin.data.generationQueue.unshift(...toRetry);
            taskProcessed = true;
        }

        // 2. 执行各阶段任务
        if (this.plugin.data.revisionQueue.length > 0) {
            taskProcessed = await this.runRevisionPhase() || taskProcessed;
        } 
        else if (this.plugin.data.reviewQueue.length > 0) {
            taskProcessed = await this.runCriticPhase() || taskProcessed;
        } 
        else if (this.plugin.data.generationQueue.length > 0) {
            taskProcessed = await this.runGenerationPhase() || taskProcessed;
        }

        // 3. 检查是否全部完成
        if (!taskProcessed &&
            this.plugin.data.generationQueue.length === 0 &&
            this.plugin.data.reviewQueue.length === 0 &&
            this.plugin.data.revisionQueue.length === 0 &&
            this.taskManager.activeCount === 0) {
            
            new Notice("🎉 All tasks completed! Engine stopped.");
            this.isRunning = false;
            this.plugin.data.status = "idle"; 
            this.updateStatusBar();
            await this._savePluginData();
            return; 
        }

        this.scheduleNextTick();
    }

    private async runGenerationPhase(): Promise<boolean> {
        const queue = this.plugin.data.generationQueue;
        if (queue.length === 0) return false;

        const maxConcurrency = this.plugin.settings.generation_batch_size;
        const slotsAvailable = maxConcurrency - this.taskManager.activeCount;
        if (slotsAvailable <= 0) return false;

        const candidates = queue.filter(idea => !this.taskManager.activeGenerations.has(idea));
        if (candidates.length === 0) return false;

        const batch = candidates.slice(0, slotsAvailable);
        
        batch.forEach(idea => {
            if(this.taskManager.addActiveTask(idea)) {
                this.generationTask(idea).catch(err => {
                    Logger.error(`Unhandled error in generation task for ${idea}:`, err);
                }).finally(() => {
                    this.taskManager.removeActiveTask(idea);
                });
            }
        });
        
        // 从队列中移除已开始处理的任务
        this.plugin.data.generationQueue = queue.filter(idea => !batch.includes(idea));
        
        this.updateStatusBar();
        this.debouncedSavePluginData();

        return true;
    }

    private async generationTask(idea: string): Promise<void> {
        const prompt = this.plugin.settings.prompt_generator.replace("{concept}", idea);
        try {
            const content = await this.apiHandler.call(prompt);
            const cleanedContent = cleanMarkdownOutput(content);
            
            await this.plugin.persistence.saveTaskContent(idea, cleanedContent);
            this.plugin.data.reviewQueue.push({ idea, content: cleanedContent });
            
            this.taskManager.clearRetryCount(idea);
            Logger.log(`✅ [Generation Success]: ${idea}`);
        } catch (e) {
            if (e instanceof AllModelsFailedError) {
                Logger.error(`❌ [Generation Failed]: ${idea} - ${e.message}`);
                // 将任务放回队首，而不是丢弃，让引擎稍后重试
                this.plugin.data.generationQueue.unshift(idea);
            } else {
                Logger.error(`⚠️ [Generation Error]: ${idea} - ${e}`);
                this.plugin.data.discardedPile.push({ idea, reason: e instanceof Error ? e.message : String(e) });
            }
        } finally {
            // 状态更新已在 tick 中处理，这里只触发保存和UI更新
            this.updateStatusBar();
            this.debouncedSavePluginData();
        }
    }

    private async runCriticPhase(): Promise<boolean> {
        const queue = this.plugin.data.reviewQueue;
        if (queue.length === 0) return false;

        const batchSize = this.plugin.settings.generation_batch_size;
        const tasksToReview = queue.splice(0, Math.min(queue.length, batchSize));

        let newIdeasFound: Set<string> = new Set();
        const tasksToRevise: TaskData[] = [];

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
                await this.saveNote(task.idea, content);
                await this.plugin.persistence.deleteTaskContent(task.idea);
                
                if (this.plugin.settings.extract_new_concepts) {
                    extractNewIdeas(content).forEach(idea => newIdeasFound.add(idea));
                }
                Logger.log(`👍 [Approved]: ${task.idea}`);
            } else {
                task.reason = reason;
                task.retries = (task.retries || 0) + 1;
                tasksToRevise.push(task);
                Logger.warn(`👎 [Rejected]: ${task.idea} - ${reason}`);
            }
        }

        this.plugin.data.revisionQueue.push(...tasksToRevise);
        
        if (newIdeasFound.size > 0) {
            this.addConceptsToQueue(Array.from(newIdeasFound));
        }

        this.updateStatusBar();
        this.debouncedSavePluginData();
        return true;
    }

    private async runRevisionPhase(): Promise<boolean> {
        const queue = this.plugin.data.revisionQueue;
        if (queue.length === 0) return false;

        const batchSize = this.plugin.settings.generation_batch_size;
        const tasksToRevise = queue.splice(0, Math.min(queue.length, batchSize));
        
        const tasksToRetry: TaskData[] = [];

        for (const task of tasksToRevise) {
            if ((task.retries || 0) >= this.plugin.settings.max_revision_retries) {
                this.plugin.data.discardedPile.push(task); 
                Logger.error(`💀 [Give up]: ${task.idea} max retries reached.`);
                continue; 
            }
            
            try {
                await this.revisionTask(task);
            } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                Logger.error(`❌ [Revision Failed]: ${task.idea} - ${errMsg}`);
                // 失败后放回队首
                tasksToRetry.push(task);
            }
        }

        // 将重试任务放回队列头部
        this.plugin.data.revisionQueue.unshift(...tasksToRetry);

        this.updateStatusBar();
        this.debouncedSavePluginData();
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
        const newContent = await this.apiHandler.call(prompt);
        const cleanedContent = cleanMarkdownOutput(newContent);
    
        await this.plugin.persistence.saveTaskContent(task.idea, cleanedContent);
        this.plugin.data.reviewQueue.push({ ...task, content: cleanedContent });
        Logger.log(`🔄 [Revision Complete]: ${task.idea}`);
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
                    Logger.warn(`Folder check/create failed: ${currentPath}`, error);
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
        
        let subFolder = "0-9_Others";
        const cleanName = filename.replace(/[\[\]]/g, '').trim();
        const firstChar = cleanName.charAt(0);

        if (/^[a-zA-Z]/.test(firstChar)) {
            subFolder = firstChar.toUpperCase();
        } 
        else if (Pinyin.isSupported(firstChar)) {
            try {
                const tokens = Pinyin.parse(firstChar);
                if (tokens && tokens.length > 0 && tokens[0].target) {
                    const pinyinLetter = tokens[0].target.charAt(0).toUpperCase(); 
                    if (/^[A-Z]/.test(pinyinLetter)) {
                        subFolder = pinyinLetter;
                    } else {
                        subFolder = "CN_Chinese";
                    }
                }
            } catch (err) {
                Logger.warn(`Pinyin parse error for ${firstChar}:`, err);
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
                // new Notice(`Note updated: ${filename}`); // 减少通知噪音
            } else {
                await this.app.vault.create(filePath, content);
                // new Notice(`Note created: ${filename}`);
            }
        } catch (error) {
            Logger.error(`Save note failed: ${filePath}`, error);
            new Notice(`Cannot save note: ${filename}`);
        }
    }

    public updateStatusBar(): void {
        if (!this.plugin.statusBarEl) return;
        const { generationQueue, reviewQueue, revisionQueue } = this.plugin.data;
        const total = generationQueue.length + reviewQueue.length + revisionQueue.length + this.taskManager.activeCount;
        
        this.plugin.statusBarEl.setText(
            `KG: ${this.plugin.data.status} | G:${generationQueue.length} | C:${reviewQueue.length} | R:${revisionQueue.length} | A:${this.taskManager.activeCount} | T:${total}`
        );
        
        this.app.workspace.trigger("kg-data-updated");
    }

    // 【优化点2】私有化，并由 debounced 函数调用
    private async _savePluginData() {
        try {
            await this.plugin.savePluginData();
        } catch (error) {
            Logger.error("Failed to save plugin data:", error);
        }
    }
}
