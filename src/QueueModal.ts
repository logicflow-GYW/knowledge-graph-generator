// src/QueueModal.ts

import { App, Modal, Setting } from 'obsidian';
import KnowledgeGraphPlugin from './main';
import { TaskData } from './types';

export class QueueManagementModal extends Modal {
    plugin: KnowledgeGraphPlugin;

    // 用于保存搜索词
    private searchTerms: { [key: string]: string } = {
        gen: '',
        rev: '',
        rep: '',
        dis: '',
    };
    
    // 默认全部折叠
    private collapseStates: { [key: string]: boolean } = {
        gen: false,
        rev: false,
        rep: false,
        dis: false,
    };

    // 用于绑定的刷新函数
    private refreshContent: () => void;

    constructor(app: App, plugin: KnowledgeGraphPlugin) {
        super(app);
        this.plugin = plugin;
        // 创建一个绑定的函数引用，用于刷新
        this.refreshContent = this.onOpen.bind(this);
    }

    onOpen() {
        const { contentEl } = this;

        // 为了安全，先注销旧的监听器
        this.app.workspace.off("kg-data-updated", this.refreshContent);

        contentEl.empty();
        contentEl.addClass('kg-modal'); 
        contentEl.createEl('h2', { text: 'Queue management dashboard' }); 

        const status = this.plugin.data.status;
        const statusText = `Status: ${status.toUpperCase()} | ${this.plugin.statusBarEl.getText()}`;
        
        // 1. 状态和启停按钮
        new Setting(contentEl)
            .setName(status === 'running' ? 'Engine running' : 'Engine paused') 
            .setDesc(statusText)
            .addButton(button => button
                .setButtonText(status === 'running' ? 'Pause engine' : 'Start engine') 
                .setCta(status !== 'running')
                .onClick(() => {
                    this.plugin.engine.toggleEngineState();
                    this.onOpen(); // 刷新 Modal 内部
                })
            );

        // 2. 渲染四个队列
        this.renderQueueSection(
            contentEl, 
            'gen', 
            'Pending generation', 
            this.plugin.data.generationQueue,
            this.renderGenerationItem.bind(this)
        );
        
        this.renderQueueSection(
            contentEl,
            'rev',
            'Pending review',
            this.plugin.data.reviewQueue,
            this.renderReviewItem.bind(this)
        );
        
        this.renderQueueSection(
            contentEl,
            'rep',
            'Pending revision',
            this.plugin.data.revisionQueue,
            this.renderRevisionItem.bind(this)
        );
        
        this.renderQueueSection(
            contentEl,
            'dis',
            'Discarded pile',
            this.plugin.data.discardedPile,
            this.renderDiscardedItem.bind(this)
        );

        // 在 onOpen 的末尾, 注册新的监听器
        this.app.workspace.on("kg-data-updated", this.refreshContent);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        
        // 在 Modal 关闭时, 必须注销监听器
        this.app.workspace.off("kg-data-updated", this.refreshContent);
    }

    /**
     * 渲染一个队列区域 (带搜索和展开/折叠)
     */
    private renderQueueSection(
        containerEl: HTMLElement,
        key: 'gen' | 'rev' | 'rep' | 'dis',
        title: string,
        data: (string | TaskData)[],
        renderFn: (container: HTMLElement, item: string | TaskData, index: number) => void
    ) {
        const displayLimit = 100; // 每次最多渲染 100 项
        const filter = this.searchTerms[key];
        
        // 1. 执行过滤
        const filteredData = data.filter(item => {
            if (!filter) return true;
            const needle = filter.toLowerCase();
            if (typeof item === 'string') {
                return item.toLowerCase().includes(needle);
            }
            return item.idea.toLowerCase().includes(needle);
        });

        const total = data.length;
        const filteredTotal = filteredData.length;
        const titleText = `${title} (${filteredTotal}${total !== filteredTotal ? ' / ' + total : ''} items)`;

        // 2. 使用 <details> 元素创建可折叠区域
        const details = containerEl.createEl('details');
        details.open = this.collapseStates[key]; // 设置初始展开/折叠状态

        // 3. 标题 (使用 CSS 类)
        const summary = details.createEl('summary', { text: titleText });
        summary.addClass('kg-modal-summary');

        // 4. 监听点击事件，保存状态
        details.addEventListener('toggle', () => {
            this.collapseStates[key] = details.open;
        });

        // 5. 搜索框 (放在 details 内部)
        new Setting(details)
            .setDesc(`Search ${title.toLowerCase()}...`) 
            .addText(text => {
                text.setPlaceholder('Enter keywords...')
                    .setValue(this.searchTerms[key])
                    .onChange(value => {
                        this.searchTerms[key] = value;
                        this.onOpen(); // 刷新 Modal
                    });
            });

        // 6. 截断数据并渲染
        const truncatedData = filteredData.slice(0, displayLimit);
        
        if (truncatedData.length === 0) {
            const desc = details.createEl('p', { text: 'Queue is empty or no matches found.', cls: 'setting-item-description' });
            desc.addClass('kg-queue-desc-empty');
            return;
        }
        
        // 7. 列表容器 (放在 details 内部，使用 CSS 类)
        const listContainer = details.createDiv('kg-list-container');

        truncatedData.forEach((item, index) => {
            renderFn(listContainer, item, index);
        });

        // 8. 显示截断提示
        if (filteredData.length > displayLimit) {
            const truncatedInfo = details.createEl('p', { 
                text: `... showing first ${displayLimit} items (total ${filteredData.length}), use search to find more.`,
                cls: 'setting-item-description'
            });
            truncatedInfo.addClass('kg-queue-desc-truncated');
        }
    }

    // --- 单项渲染函数 ---

    private renderGenerationItem(container: HTMLElement, item: string | TaskData) {
        // item 在 generation queue 中通常是 string
        const itemName = typeof item === 'string' ? item : item.idea;
        
        new Setting(container)
            .setName(itemName)
            .addButton(btn => btn
                .setIcon('trash')
                .setTooltip('Delete concept') 
                .onClick(async () => {
                    const queue = this.plugin.data.generationQueue;
                    const index = queue.indexOf(itemName);
                    if (index > -1) {
                        queue.splice(index, 1);
                        await this.plugin.savePluginData();
                        this.plugin.engine.updateStatusBar();
                        this.onOpen(); // 刷新
                    }
                }) 
            );
    }

    private renderReviewItem(container: HTMLElement, item: string | TaskData) {
        const task = item as TaskData;
        new Setting(container)
            .setName(`Review: ${task.idea}`) // Modified to avoid [Review] title case warning
            .addButton(btn => btn
                .setIcon('trash')
                .setTooltip('Discard task') 
                .onClick(async () => {
                    this.plugin.data.reviewQueue.splice(this.plugin.data.reviewQueue.indexOf(task), 1);
                    this.plugin.data.discardedPile.push(task);
                    await this.plugin.savePluginData();
                    this.plugin.engine.updateStatusBar();
                    this.onOpen();
                })
            );
    }
    
    private renderRevisionItem(container: HTMLElement, item: string | TaskData) {
        const task = item as TaskData;
        new Setting(container)
            .setName(`Revision: ${task.idea}`) // Modified
            .setDesc(`Reason: ${task.reason || 'Unknown'}`)
            .addButton(btn => btn
                .setIcon('trash')
                .setTooltip('Discard task') 
                .onClick(async () => {
                    this.plugin.data.revisionQueue.splice(this.plugin.data.revisionQueue.indexOf(task), 1);
                    this.plugin.data.discardedPile.push(task);
                    await this.plugin.savePluginData();
                    this.plugin.engine.updateStatusBar();
                    this.onOpen();
                })
            );
    }
    
    private renderDiscardedItem(container: HTMLElement, item: string | TaskData) {
        const task = item as TaskData;
        new Setting(container)
            .setName(`Discarded: ${task.idea}`) // Modified
            .setDesc(`Last reason: ${task.reason || 'Unknown'}`)
            .addButton(btn => btn
                .setIcon('refresh-cw')
                .setTooltip('Re-queue (generation)') 
                .onClick(() => {
                    this.plugin.data.discardedPile.splice(this.plugin.data.discardedPile.indexOf(task), 1);
                    this.plugin.engine.addConceptsToQueue([task.idea]); // 使用 engine 的方法
                    this.onOpen();
                })
            );
    }
}