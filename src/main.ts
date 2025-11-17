import { App, Plugin, PluginSettingTab, Setting, Notice, TFile } from 'obsidian';
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
        // 1. 首先加载设置 (settings)
        await this.loadSettings();

        // 2. 然后加载插件状态
        await this.loadPluginData();
        
        this.engine = new Engine(this);

        // 缎带图标
        const ribbonIconEl = this.addRibbonIcon('brain-circuit', '知识图谱生成器', (evt: MouseEvent) => {
            this.engine.toggleEngineState();
        });
        ribbonIconEl.addClass('knowledge-graph-plugin-ribbon-class');

        // 状态栏
        this.statusBarEl = this.addStatusBarItem();
        this.engine.updateStatusBar();

        // 设置选项卡
        this.addSettingTab(new KGsSettingTab(this.app, this));

        // 命令
        this.addCommand({
            id: 'toggle-knowledge-graph-engine',
            name: '启动/暂停 知识图谱生成',
            callback: () => {
                this.engine.toggleEngineState();
            },
        });

        this.addCommand({
            id: 'add-current-note-to-queue',
            name: '将当前笔记标题添加到生成队列',
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

        console.log('知识图谱插件已加载！');
    }

    onunload() {
        console.log('知识图谱插件已卸载。');
    }

    /**
     * 加载插件的配置。
     * 它会合并默认设置、默认提示和用户保存的设置。
     * 这个方法需要兼容旧版本的数据结构。
     */
    async loadSettings() {
        const defaultPrompts = await getDefaultPrompts();
        // loadData() 会读取整个 data.json 文件
        const savedData = await this.loadData();
        // 从保存的数据中提取设置部分
        const savedSettings = savedData || {};
        
        // 合并所有设置，确保所有配置项都有值
        this.settings = Object.assign({}, DEFAULT_SETTINGS, defaultPrompts, savedSettings);
    }

    /**
     * 保存插件的配置和状态。
     * 这是唯一一个直接写入文件的方法，它将所有数据打包在一起。
     */
    async saveSettings() {
        const dataToSave = { ...this.settings, pluginState: this.data };
        await this.saveData(dataToSave);
    }
    
    /**
     * 加载插件的运行时状态。
     * 它会从保存的数据中提取 pluginState 部分。
     */
    async loadPluginData() {
        // loadData() 会读取整个 data.json 文件
        const savedData = await this.loadData();
        // 从保存的数据中提取状态部分
        const savedState = savedData?.pluginState || {};
        
        // 合并默认状态和用户保存的状态
        this.data = Object.assign({}, DEFAULT_PLUGIN_DATA, savedState);
    }

    /**
     * 保存插件的运行时状态。
     * 这个方法只是一个方便的别名，它实际上调用 saveSettings。
     * 这保证了状态和配置总是在一起被原子性地保存。
     */
    async savePluginData() {
        await this.saveSettings();
    }
}
