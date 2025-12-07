import { App, normalizePath } from 'obsidian';
import { PluginData, TaskData } from './types';
import KnowledgeGraphPlugin from './main';
import { Logger } from './utils';

// 【修复】纯 JS 实现的 Hash 函数，替代 Node.js crypto
function simpleHash(str: string): string {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
    }
    return (hash >>> 0).toString(16);
}

class DataLock {
    private locked = false;
    private waitQueue: (() => void)[] = [];
    async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        return new Promise(resolve => this.waitQueue.push(resolve));
    }
    release(): void {
        if (this.waitQueue.length > 0) {
            const nextResolve = this.waitQueue.shift()!;
            nextResolve();
        } else {
            this.locked = false;
        }
    }
}

export class Persistence {
    private plugin: KnowledgeGraphPlugin;
    private app: App;
    private cacheDir: string;
    private queueFile: string;
    private oldQueueFile: string;
    private dataLock = new DataLock();

    constructor(plugin: KnowledgeGraphPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.cacheDir = normalizePath(`${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/task_cache_v2`);
        this.queueFile = normalizePath(`${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/queues_v2.json`);
        this.oldQueueFile = normalizePath(`${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/queues.json`);
    }

    async init() {
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(this.cacheDir))) {
            await adapter.mkdir(this.cacheDir);
        }
        await this.migrateIfNecessary();
        Logger.log(`Persistence initialized.`);
    }

    private async migrateIfNecessary(): Promise<void> {
        const adapter = this.app.vault.adapter;
        if (await adapter.exists(this.oldQueueFile) && !(await adapter.exists(this.queueFile))) {
            try {
                const oldContent = await adapter.read(this.oldQueueFile);
                const oldData = JSON.parse(oldContent);
                await adapter.write(this.queueFile, JSON.stringify(oldData, null, 2));
                const backupPath = this.oldQueueFile + ".bak";
                if(await adapter.exists(backupPath)) await adapter.remove(backupPath);
                await adapter.rename(this.oldQueueFile, backupPath);
            } catch (e) {
                Logger.error("Migration failed:", e);
            }
        }
    }

    async loadQueueData(): Promise<PluginData | null> {
        const adapter = this.app.vault.adapter;
        if (await adapter.exists(this.queueFile)) {
            try {
                const content = await adapter.read(this.queueFile);
                return JSON.parse(content);
            } catch (e) {
                Logger.error("Failed to load queue data:", e);
                return { status: 'idle', generationQueue: [], reviewQueue: [], revisionQueue: [], discardedPile: [], history: [] };
            }
        }
        return null;
    }

    async saveQueueData(data: PluginData) {
        await this.dataLock.acquire();
        try {
            const cleanData = JSON.parse(JSON.stringify(data));
            const stripContent = (queue: TaskData[]) => queue.forEach(task => delete task.content);
            stripContent(cleanData.reviewQueue);
            stripContent(cleanData.revisionQueue);
            stripContent(cleanData.discardedPile);
            const adapter = this.app.vault.adapter;
            await adapter.write(this.queueFile, JSON.stringify(cleanData, null, 2));
        } catch (e) {
            Logger.error("Failed to save queue data:", e);
        } finally {
            this.dataLock.release();
        }
    }

    private getCachePath(idea: string): string {
        const hash = simpleHash(idea);
        return `${this.cacheDir}/${hash}.md`;
    }

    async saveTaskContent(idea: string, content: string) {
        const path = this.getCachePath(idea);
        const checksum = simpleHash(content);
        const dataToSave = JSON.stringify({ content, checksum });
        try {
            await this.app.vault.adapter.write(path, dataToSave);
        } catch (e) {
            Logger.error(`Failed to save content cache:`, e);
        }
    }

    async loadTaskContent(idea: string): Promise<string> {
        const path = this.getCachePath(idea);
        try {
            if (await this.app.vault.adapter.exists(path)) {
                const dataString = await this.app.vault.adapter.read(path);
                const { content, checksum } = JSON.parse(dataString);
                return content;
            }
        } catch (e) {
            Logger.error(`Failed to load content cache:`, e);
        }
        return "";
    }

    async deleteTaskContent(idea: string) {
        const path = this.getCachePath(idea);
        try {
            if (await this.app.vault.adapter.exists(path)) {
                await this.app.vault.adapter.remove(path);
            }
        } catch (e) {
            Logger.warn(`Failed to delete content cache:`, e);
        }
    }

    public async cleanupOrphanedFiles(): Promise<number> {
        const queueData = await this.loadQueueData();
        if (!queueData) return 0;
        const validIdeas = new Set<string>();
        const collectIdeas = (queue: TaskData[]) => queue.forEach(task => validIdeas.add(task.idea));
        collectIdeas(queueData.reviewQueue);
        collectIdeas(queueData.revisionQueue);
        collectIdeas(queueData.discardedPile);
        const validPaths = new Set<string>();
        validIdeas.forEach(idea => validPaths.add(this.getCachePath(idea)));
        const adapter = this.app.vault.adapter;
        let allFiles: string[] = [];
        try { allFiles = await adapter.list(this.cacheDir).then(r => r.files); } catch (e) { return 0; }
        let deletedCount = 0;
        for (const file of allFiles) {
            if (!validPaths.has(file)) {
                try { await adapter.remove(file); deletedCount++; } catch (e) {}
            }
        }
        return deletedCount;
    }
}