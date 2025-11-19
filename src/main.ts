// src/main.ts

import { Plugin } from 'obsidian';
import { KnowledgeGraphPluginSettings, PluginData } from './types';
import { KGsSettingTab, DEFAULT_SETTINGS, getDefaultPrompts } from './settings';
import { Engine } from './engine';

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
    statusBarEl: HTMLElement;

    async onload() {
        // 1. 首先加载设置
        await this.loadSettings();

        // 2. 然后加载插件状态
        await this.loadPluginData();
        
        this.engine = new Engine(this);

        const ribbonIconEl = this.addRibbonIcon('brain-circuit', 'Knowledge Graph Generator', (evt: MouseEvent) => {
            this.engine.toggleEngineState();
        });
        ribbonIconEl.addClass('knowledge-graph-plugin-ribbon-class');

        this.statusBarEl = this.addStatusBarItem();
        this.engine.updateStatusBar();

        this.addSettingTab(new KGsSettingTab(this.app, this));

        this.addCommand({
            id: 'toggle-knowledge-graph-engine',
            name: 'Start/Pause Knowledge Graph generation',
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
        
        // 修改：console.log -> console.debug
        console.debug('Knowledge Graph plugin loaded.');
    }

    onunload() {
        console.debug('Knowledge Graph plugin unloaded.');
    }

    async loadSettings() {
        // 修改：getDefaultPrompts 已经是同步函数，去掉 await
        const defaultPrompts = getDefaultPrompts();
        const savedData = await this.loadData();
        const savedSettings = savedData || {};
        
        this.settings = Object.assign({}, DEFAULT_SETTINGS, defaultPrompts, savedSettings);
    }

    async saveSettings() {
        const dataToSave = { ...this.settings, pluginState: this.data };
        await this.saveData(dataToSave);
    }
    
    async loadPluginData() {
        const savedData = await this.loadData();
        const savedState = savedData?.pluginState || {};
        
        this.data = Object.assign({}, DEFAULT_PLUGIN_DATA, savedState);
    }

    async savePluginData() {
        await this.saveSettings();
    }
}