// engine.ts

import { Notice, TFile, TFolder, normalizePath, App } from "obsidian";
import KnowledgeGraphPlugin from "./main";
import { APIHandler, AllModelsFailedError } from "./apiHandler";
import { Critic } from "./critic";
import { Reviser } from "./reviser";
import { sanitizeFilename, extractNewIdeas, cleanMarkdownOutput } from "./utils";
// 导入 TaskData 类型
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
    /**
     * 切换引擎的运行/暂停状态
     */
    public toggleEngineState(): void {
        if (this.isRunning) {
            this.stop();
        } else {
            this.start();
        }
    }

    /**
     * 添加单个概念到队列，并显示通知
     * @returns {boolean} 是否成功添加
     */
    public addConceptToQueue(concept: string): boolean {
        const added = this.addConceptsToQueue([concept]);
        if (added > 0) {
            new Notice(`'${concept}' 已添加到生成队列。`);
            this.updateStatusBar();
            return true;
        }
        new Notice(`'${concept}' 已存在于队列或仓库中，未添加。`);
        return false;
    }

    /**
     * 添加多个概念到生成队列，会进行去重和检查文件是否存在
     * @param {string[]} concepts - 要添加的概念列表
     * @returns {number} 实际添加的新概念数量
     */
    public addConceptsToQueue(concepts: string[]): number {
        const currentQueue = new Set(this.plugin.data.generationQueue);
        // 获取一个Set，包含所有已存在笔记的 basename (无 .md 后缀)
        const existingFiles = new Set(this.app.vault.getMarkdownFiles().map(f => f.basename));

        let addedCount = 0;
        for (const concept of concepts) {
            const sanitized = sanitizeFilename(concept);
            // 检查：1. 队列中没有 2. 仓库中也没有同名文件
            if (!currentQueue.has(concept) && !existingFiles.has(sanitized)) {
                this.plugin.data.generationQueue.push(concept);
                currentQueue.add(concept); // 保持 Set 同步，用于单次运行中的去重
                addedCount++;
            }
        }

        if (addedCount > 0) {
            this.plugin.savePluginData(); // 保存已更新的队列
            this.updateStatusBar();
        }
        return addedCount;
    }

    // --- Core Loop ---
    /**
     * 启动引擎
     */
    private async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        this.plugin.data.status = "running";
        new Notice("知识图谱引擎已启动！");
        this.updateStatusBar();
        // 立即开始第一个 tick
        this.tick(); 
    }

    /**
     * 停止引擎
     */
    private stop(): void {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.plugin.data.status = "paused";
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        new Notice("知识图谱引擎已暂停。");
        this.updateStatusBar();
        this.plugin.savePluginData(); // 在暂停时保存状态
    }

    /**
     * 安排下一个 tick
     */
    private scheduleNextTick(): void {
        if (!this.isRunning) return;
        const delay = this.plugin.settings.request_delay * 1000;
        this.timerId = setTimeout(() => this.tick(), delay);
    }

    /**
     * 引擎的核心“心跳”
     * 它会按优先级（修正 > 审核 > 生成）处理一个批次的任务
     */
    private async tick(): Promise<void> {
        if (!this.isRunning) return;

        try {
            let taskProcessed = false;

            // 1. 优先处理修正队列
            if (this.plugin.data.revisionQueue.length > 0) {
                taskProcessed = await this.runRevisionPhase();
            } 
            // 2. 其次处理审核队列
            else if (this.plugin.data.reviewQueue.length > 0) {
                taskProcessed = await this.runCriticPhase();
            } 
            // 3. 最后处理生成队列
            else if (this.plugin.data.generationQueue.length > 0) {
                taskProcessed = await this.runGenerationPhase();
            }

            // 检查是否所有队列都已清空
            if (!taskProcessed &&
                this.plugin.data.generationQueue.length === 0 &&
                this.plugin.data.reviewQueue.length === 0 &&
                this.plugin.data.revisionQueue.length === 0) {
                
                new Notice("🎉 所有任务完成！引擎已停止。");
                this.isRunning = false;
                this.plugin.data.status = "idle"; // 设为空闲状态
                this.updateStatusBar();
                await this.plugin.savePluginData(); // 保存最终状态
                return; // 停止 tick 循环
            }

        } catch (error) {
            console.error("引擎 Tick 发生严重错误:", error);
            new Notice("引擎遇到错误，已暂停。请检查控制台。");
            this.stop(); // 发生严重错误时停止引擎
            return;
        }

        // 如果引擎仍在运行，则安排下一次心跳
        this.scheduleNextTick();
    }

    // --- Phases ---
    /**
     * 运行“生成”阶段
     * @returns {Promise<boolean>} 是否处理了任务
     */
    private async runGenerationPhase(): Promise<boolean> {
        const queue = this.plugin.data.generationQueue;
        if (queue.length === 0) return false;

        const batchSize = this.plugin.settings.generation_batch_size;
        // 取出一个批次的任务
        const batch = queue.splice(0, Math.min(queue.length, batchSize));

        this.updateStatusBar();
        await this.plugin.savePluginData(); // 保存已取出任务的队列

        // 并行处理这一批次的所有任务
        const tasks = batch.map(idea => this.generationTask(idea));
        await Promise.allSettled(tasks);

        await this.plugin.savePluginData(); // 保存（可能）已推入审核队列的新数据
        return true;
    }

    /**
     * 单个生成任务
     */
    private async generationTask(idea: string): Promise<void> {
        const prompt = this.plugin.settings.prompt_generator.replace("{concept}", idea);
        try {
            const content = await this.apiHandler.call(prompt);
            const cleanedContent = cleanMarkdownOutput(content);
            // 成功后，推入审核队列
            this.plugin.data.reviewQueue.push({ idea, content: cleanedContent });
            console.log(`✅ [生成成功]: ${idea}`);
        } catch (e) {
            if (e instanceof AllModelsFailedError) {
                console.error(`❌ [生成失败]: ${idea} - ${e.message}`);
                // 失败后，放回队列头部，以便下次重试
                this.plugin.data.generationQueue.unshift(idea); 
            }
        }
    }

    /**
     * 运行“审核”阶段
     * @returns {Promise<boolean>} 是否处理了任务
     */
    private async runCriticPhase(): Promise<boolean> {
        const queue = this.plugin.data.reviewQueue;
        if (queue.length === 0) return false;

        const batchSize = this.plugin.settings.generation_batch_size;
        const tasksToReview = queue.splice(0, Math.min(queue.length, batchSize));

        this.updateStatusBar();
        await this.plugin.savePluginData(); // 保存已取出任务的队列

        let newIdeasFound: Set<string> = new Set();

        for (const task of tasksToReview) {
            const { isApproved, reason } = await this.critic.judge(task.content);
            if (isApproved) {
                // 1. 批准，保存笔记
                await this.saveNote(task.idea, task.content);
                
                // 【【【 新功能 】】】
                // 仅在开启设置后才提取新概念
                if (this.plugin.settings.extract_new_concepts) {
                    const ideas = extractNewIdeas(task.content);
                    ideas.forEach(idea => newIdeasFound.add(idea));
                }
                // 【【【 新功能结束 】】】

                console.log(`👍 [审核通过]: ${task.idea}`);
            } else {
                // 2. 拒绝，设置原因、重试次数，推入修正队列
                task.reason = reason;
                task.retries = (task.retries || 0) + 1;
                this.plugin.data.revisionQueue.push(task);
                console.warn(`👎 [审核拒绝]: ${task.idea} - ${reason}`);
            }
        }

        // 如果找到了新概念，将它们批量加入生成队列
        if (newIdeasFound.size > 0) {
            this.addConceptsToQueue(Array.from(newIdeasFound));
        }

        await this.plugin.savePluginData(); // 保存审核/修正/生成队列的状态
        return true;
    }

    /**
     * 运行“修正”阶段
     * @returns {Promise<boolean>} 是否处理了任务
     */
    private async runRevisionPhase(): Promise<boolean> {
        const queue = this.plugin.data.revisionQueue;
        if (queue.length === 0) return false;

        const batchSize = this.plugin.settings.generation_batch_size;
        const tasksToRevise = queue.splice(0, Math.min(queue.length, batchSize));

        this.updateStatusBar();
        await this.plugin.savePluginData(); // 保存已取出任务的队列

        for (const task of tasksToRevise) {
            // 检查是否达到最大重试次数
            if ((task.retries || 0) >= this.plugin.settings.max_revision_retries) {
                this.plugin.data.discardedPile.push(task); // 放入丢弃堆
                console.error(`💀 [放弃修正]: ${task.idea} 已达最大重试次数。`);
                continue; // 不再处理此任务
            }
            // 未达次数，执行修正任务
            await this.revisionTask(task);
        }

        await this.plugin.savePluginData(); // 保存修正/审核/丢弃堆的状态
        return true;
    }

    /**
     * 单个修正任务
     */
    private async revisionTask(task: TaskData): Promise<void> {
        const prompt = this.reviser.createRevisionPrompt(task.idea, task.content, task.reason || "未知原因");
        try {
            const newContent = await this.apiHandler.call(prompt);
            const cleanedContent = cleanMarkdownOutput(newContent);
            const revisedTask: TaskData = { ...task, content: cleanedContent };
            // 修正后，放回审核队列
            this.plugin.data.reviewQueue.push(revisedTask); 
            console.log(`🔄 [修正完成]: ${task.idea}`);
        } catch (e) {
            console.error(`❌ [修正失败]: ${task.idea} - ${e.message}`);
            // 失败后，放回修正队列头部，以便下次重试
            this.plugin.data.revisionQueue.unshift(task); 
        }
    }

    // --- File & UI ---
    /**
     * 保存笔记到文件系统
     */
    private async saveNote(idea: string, content: string): Promise<void> {
        const filename = sanitizeFilename(idea);
        const folderPath = this.plugin.settings.output_dir;

        // 检查文件夹是否存在，不存在则创建
        if (!(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
            try {
                await this.app.vault.createFolder(folderPath);
            } catch (error) {
                console.error(`创建文件夹失败: ${folderPath}`, error);
                new Notice(`无法创建输出文件夹: ${folderPath}`);
                return; // 无法创建文件夹，停止保存
            }
        }
        
        const filePath = normalizePath(`${folderPath}/${filename}.md`);
        const file = this.app.vault.getAbstractFileByPath(filePath);

        try {
            if (file instanceof TFile) {
                // 文件已存在，修改内容
                await this.app.vault.modify(file, content);
                new Notice(`笔记已更新: ${filename}`);
            } else {
                // 文件不存在，创建新文件
                await this.app.vault.create(filePath, content);
                new Notice(`笔记已创建: ${filename}`);
            }
        } catch (error) {
            console.error(`保存笔记失败: ${filePath}`, error);
            new Notice(`无法保存笔记: ${filename}`);
        }
    }

    /**
     * 更新状态栏显示
     */
    public updateStatusBar(): void {
        if (!this.plugin.statusBarEl) return;
        const { generationQueue, reviewQueue, revisionQueue } = this.plugin.data;
        const total = generationQueue.length + reviewQueue.length + revisionQueue.length;
        // 显示: KG: [状态] | G:[待生成] | C:[待审核] | R:[待修正] | Total:[总数]
        this.plugin.statusBarEl.setText(
            `KG: ${this.plugin.data.status} | G:${generationQueue.length} | C:${reviewQueue.length} | R:${revisionQueue.length} | Total:${total}`
        );
        
        // 【【【 实时刷新修改：在此处广播数据已更新的信号 】】】
        this.app.workspace.trigger("kg-data-updated");
    }
}
