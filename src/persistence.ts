// src/persistence.ts

import { App, normalizePath } from 'obsidian';
import { PluginData, TaskData } from './types';
import KnowledgeGraphPlugin from './main';
import { Logger } from './utils';

export class Persistence {
    private plugin: KnowledgeGraphPlugin;
    private app: App;
    private cacheDir: string;
    private queueFile: string;

    constructor(plugin: KnowledgeGraphPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        // 插件配置目录下的缓存文件夹
        this.cacheDir = normalizePath(`${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/task_cache`);
        // 独立的队列数据文件
        this.queueFile = normalizePath(`${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/queues.json`);
    }

    async init() {
        // 确保缓存目录存在
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(this.cacheDir))) {
            await adapter.mkdir(this.cacheDir);
        }
    }

    // --- 队列元数据 (轻量级) ---

    async loadQueueData(): Promise<PluginData | null> {
        const adapter = this.app.vault.adapter;
        if (await adapter.exists(this.queueFile)) {
            try {
                const content = await adapter.read(this.queueFile);
                return JSON.parse(content);
            } catch (e) {
                Logger.error("Failed to load queue data:", e);
                return null;
            }
        }
        return null;
    }

    async saveQueueData(data: PluginData) {
        // 深拷贝数据，移除 content 字段，防止大文本写入 JSON
        const cleanData = JSON.parse(JSON.stringify(data));
        
        const stripContent = (queue: TaskData[]) => {
            queue.forEach(task => {
                delete task.content; // 仅保留元数据
            });
        };

        stripContent(cleanData.reviewQueue);
        stripContent(cleanData.revisionQueue);
        stripContent(cleanData.discardedPile);

        const adapter = this.app.vault.adapter;
        try {
            await adapter.write(this.queueFile, JSON.stringify(cleanData, null, 2));
        } catch (e) {
            Logger.error("Failed to save queue data:", e);
        }
    }

    // --- 任务内容 (重量级 - 独立文件) ---

    private getCachePath(idea: string): string {
        // 使用 sanitizeFilename 确保文件名合法，但要避免冲突，最好加个 hash 或保持简单
        // 这里假设 sanitizeFilename 足够安全
        const safeName = idea.replace(/[\\/*?:"<>|]/g, "").trim().slice(0, 100);
        return `${this.cacheDir}/${safeName}.md`;
    }

    async saveTaskContent(idea: string, content: string) {
        const path = this.getCachePath(idea);
        try {
            await this.app.vault.adapter.write(path, content);
            Logger.log(`Saved content cache for: ${idea}`);
        } catch (e) {
            Logger.error(`Failed to save content cache for ${idea}:`, e);
        }
    }

    async loadTaskContent(idea: string): Promise<string> {
        const path = this.getCachePath(idea);
        try {
            if (await this.app.vault.adapter.exists(path)) {
                return await this.app.vault.adapter.read(path);
            }
        } catch (e) {
            Logger.error(`Failed to load content cache for ${idea}:`, e);
        }
        return ""; // 如果丢失或读取失败，返回空
    }

    async deleteTaskContent(idea: string) {
        const path = this.getCachePath(idea);
        try {
            if (await this.app.vault.adapter.exists(path)) {
                await this.app.vault.adapter.remove(path);
                Logger.log(`Deleted content cache for: ${idea}`);
            }
        } catch (e) {
            Logger.warn(`Failed to delete content cache for ${idea} (might allow cleanup later):`, e);
        }
    }
}