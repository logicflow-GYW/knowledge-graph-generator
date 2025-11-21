// src/main.ts

import { Plugin } from 'obsidian';
import { KnowledgeGraphPluginSettings, PluginData } from './types';
import { KGsSettingTab, DEFAULT_SETTINGS, getDefaultPrompts } from './settings';
import { Engine } from './engine';
import { Persistence } from './persistence';
import { Logger } from './utils';

const DEFAULT_PLUGIN_DATA: PluginData = {
    status: 'idle',
    generationQueue: [],
    reviewQueue: [],
    revisionQueue: [],
    discardedPile: [],
};

export default class KnowledgeGraphPlugin extends Plugin {
    settings: KnowledgeGraphPluginSettings;
    data: PluginData;
    engine: Engine;
    persistence: Persistence;
    statusBarEl: HTMLElement;

    async onload() {
        // 1. 加载设置 (data.json)
        await this.loadSettings();
        Logger.setDebugMode(this.settings.debug_mode);

        // 2. 初始化持久化模块
        this.persistence = new Persistence(this);
        await this.persistence.init();

        // 3. 加载队列数据 (queues.json)
        await this.loadPluginData();
        
        this.engine = new Engine(this);

        const ribbonIconEl = this.addRibbonIcon('brain-circuit', 'Knowledge graph generator', (evt: MouseEvent) => {
            this.engine.toggleEngineState();
        });
        ribbonIconEl.addClass('knowledge-graph-plugin-ribbon-class');

        this.statusBarEl = this.addStatusBarItem();
        this.engine.updateStatusBar();

        this.addSettingTab(new KGsSettingTab(this.app, this));

        this.addCommand({
            id: 'toggle-knowledge-graph-engine',
            name: 'Start/pause knowledge graph generation',
            callback: () => {
                this.engine.toggleEngineState();
            },
        });

        this.addCommand({
            id: 'add-current-note-to-queue',
            name: 'Add current note title to generation queue',
            checkCallback: (checking: boolean) => {
                const file = this.app.workspace.getActiveFile();
                if (file) {
                    if (!checking) {
                        this.engine.addConceptToQueue(file.basename);
                    }
                    return true;
                }
                return false;
            },
        });
        
        Logger.log('Knowledge Graph plugin loaded.');
    }

    onunload() {
        Logger.log('Knowledge Graph plugin unloaded.');
    }

    async loadSettings() {
        const defaultPrompts = getDefaultPrompts();
        const savedData = await this.loadData(); // 从 data.json 加载
        this.settings = Object.assign({}, DEFAULT_SETTINGS, defaultPrompts, savedData);
    }

    async saveSettings() {
        // 仅保存 settings 到 data.json，不保存 pluginState
        await this.saveData(this.settings);
    }
    
    async loadPluginData() {
        // 从 queues.json 加载队列
        const savedState = await this.persistence.loadQueueData();
        this.data = Object.assign({}, DEFAULT_PLUGIN_DATA, savedState || {});
    }

    async savePluginData() {
        // 保存队列到 queues.json
        await this.persistence.saveQueueData(this.data);
    }
}