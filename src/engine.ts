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
    
    // 【修改】改为 Map，存储任务开始时间，用于超时检查 (看门狗)
    private activeGenerations: Map<string, number> = new Map();
    // 5分钟超时阈值，防止任务永久卡死占用并发槽
    private readonly TASK_TIMEOUT_MS = 5 * 60 * 1000; 

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
        
        if (this.activeGenerations.has(concept)) {
             new Notice(`'${concept}' is currently being generated.`);
             return false;
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
            // 检查：不在队列中、文件不存在、且当前没有正在生成
            if (!currentQueue.has(concept) && 
                !existingFiles.has(sanitized) && 
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

    // 【新增】僵尸任务清理器
    private cleanupZombieTasks() {
        const now = Date.now();
        for (const [idea, startTime] of this.activeGenerations.entries()) {
            if (now - startTime > this.TASK_TIMEOUT_MS) {
                Logger.warn(`🧹 [Zombie Sweeper]: Removing stuck task '${idea}' after ${this.TASK_TIMEOUT_MS / 1000}s.`);
                this.activeGenerations.delete(idea);
                // 注意：这里可以选择将任务放回队列重试，或者直接丢弃。
                // 为了防止死循环，这里选择不做操作（视为失败），用户可以在日志看到。
            }
        }
    }

    private async tick(): Promise<void> {
        if (!this.isRunning) return;

        try {
            // 每次心跳先清理僵尸任务
            this.cleanupZombieTasks();

            let taskProcessed = false;

            if (this.plugin.data.revisionQueue.length > 0) {
                taskProcessed = await this.runRevisionPhase();
            } 
            else if (this.plugin.data.reviewQueue.length > 0) {
                taskProcessed = await this.runCriticPhase();
            } 
            else if (this.plugin.data.generationQueue.length > 0) {
                // Generation 阶段现在是非阻塞的滑动窗口
                taskProcessed = await this.runGenerationPhase();
            }

            if (!taskProcessed &&
                this.plugin.data.generationQueue.length === 0 &&
                this.plugin.data.reviewQueue.length === 0 &&
                this.plugin.data.revisionQueue.length === 0) {
                
                // 只有当没有任何 active 任务时才完全停止
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
            new Notice("Engine encountered an error and paused. Check console.");
            this.stop(); 
            return;
        }

        this.scheduleNextTick();
    }

    // --- Phases ---
    
    // 【重构】滑动窗口模式
    private async runGenerationPhase(): Promise<boolean> {
        const queue = this.plugin.data.generationQueue;
        if (queue.length === 0) return false;

        const maxConcurrency = this.plugin.settings.generation_batch_size;
        const currentActive = this.activeGenerations.size;
        const slotsAvailable = maxConcurrency - currentActive;

        // 如果没有空槽位，直接跳过，等待下一轮 tick
        if (slotsAvailable <= 0) return false;

        // 筛选出不在运行中的任务
        const candidates = queue.filter(idea => !this.activeGenerations.has(idea));
        if (candidates.length === 0) return false;

        // 取出填满槽位所需的任务数
        const batch = candidates.slice(0, slotsAvailable);

        // 立即锁定这些任务
        batch.forEach(idea => this.activeGenerations.set(idea, Date.now()));
        
        this.updateStatusBar();
        await this.plugin.savePluginData();

        // 【关键】触发后台执行，不使用 await 阻塞 tick
        // 我们不需要 Promise.allSettled，因为每个任务会在完成后自己清理状态
        batch.forEach(idea => {
            this.generationTask(idea).catch(err => {
                Logger.error(`Unhandled error in background generation task for ${idea}:`, err);
                // 确保异常情况下锁也能解开（双重保险，已有 finally）
                this.activeGenerations.delete(idea);
            });
        });

        // 只要触发了任务，就返回 true，表示引擎在工作
        return true;
    }

    private async generationTask(idea: string): Promise<void> {
        const prompt = this.plugin.settings.prompt_generator.replace("{concept}", idea);
        try {
            const content = await this.apiHandler.call(prompt);
            const cleanedContent = cleanMarkdownOutput(content);
            
            // 保存内容到缓存文件
            await this.plugin.persistence.saveTaskContent(idea, cleanedContent);
            
            // 队列中只保存元数据
            this.plugin.data.reviewQueue.push({ idea, content: cleanedContent });
            
            // 成功后，从 generationQueue 中移除
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
                // 普通错误（如超时），任务保留在队列，锁释放后下一轮会重试
            }
        } finally {
            // 【关键】任务结束（无论成功失败），释放并发槽位
            this.activeGenerations.delete(idea);
            // 触发一次保存，确保队列变更持久化
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

    // --- File & UI ---
    
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
        const folderPath = this.plugin.settings.output_dir;

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