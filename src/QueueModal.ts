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
        this.refreshContent = this.onOpen.bind(this);
    }

    onOpen() {
        const { contentEl } = this;

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
                    this.onOpen(); 
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

        this.app.workspace.on("kg-data-updated", this.refreshContent);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
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
        const displayLimit = 100; 
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
        details.open = this.collapseStates[key]; 

        // 3. 标题
        const summary = details.createEl('summary', { text: titleText });
        summary.addClass('kg-modal-summary');

        // 4. 监听点击事件，保存状态
        details.addEventListener('toggle', () => {
            this.collapseStates[key] = details.open;
        });

        // 5. 搜索框
        new Setting(details)
            .setDesc(`Search ${title.toLowerCase()}...`) 
            .addText(text => {
                text.setPlaceholder('Enter keywords...')
                    .setValue(this.searchTerms[key])
                    .onChange(value => {
                        this.searchTerms[key] = value;
                        this.onOpen(); 
                    });
            });

        // 6. 截断数据并渲染
        const truncatedData = filteredData.slice(0, displayLimit);
        
        if (truncatedData.length === 0) {
            const desc = details.createEl('p', { text: 'Queue is empty or no matches found.', cls: 'setting-item-description' });
            desc.addClass('kg-queue-desc-empty');
            return;
        }
        
        // 7. 列表容器
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
                        this.onOpen(); 
                    }
                }) 
            );
    }

    private renderReviewItem(container: HTMLElement, item: string | TaskData) {
        const task = item as TaskData;
        new Setting(container)
            .setName(`Review: ${task.idea}`) 
            .addButton(btn => btn
                .setIcon('trash')
                .setTooltip('Move to discarded') // 修改提示：只是移动，不删文件
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
            .setName(`Revision: ${task.idea}`) 
            .setDesc(`Reason: ${task.reason || 'Unknown'}`)
            .addButton(btn => btn
                .setIcon('trash')
                .setTooltip('Move to discarded') // 修改提示
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
            .setName(`Discarded: ${task.idea}`)
            .setDesc(`Last reason: ${task.reason || 'Unknown'}`)
            .addButton(btn => btn
                .setIcon('refresh-cw')
                .setTooltip('Re-queue (generation)') 
                .onClick(async () => {
                    // 重新排队时，可以选择是否保留旧内容。这里逻辑保持不变，重新排入 Generation 队列会重新生成。
                    // 建议：如果要彻底重新生成，最好把旧缓存删了，防止 Revision 阶段读取旧的坏文件。
                    await this.plugin.persistence.deleteTaskContent(task.idea);

                    this.plugin.data.discardedPile.splice(this.plugin.data.discardedPile.indexOf(task), 1);
                    this.plugin.engine.addConceptsToQueue([task.idea]); 
                    this.onOpen();
                })
            )
            // 【新增】彻底删除按钮
            .addButton(btn => btn
                .setIcon('cross') // 使用 cross 或 trash-2
                .setTooltip('Delete Permanently (Clear Cache)')
                .setClass('mod-warning') // 设置为警告色（红色）
                .onClick(async () => {
                    const index = this.plugin.data.discardedPile.indexOf(task);
                    if (index > -1) {
                        this.plugin.data.discardedPile.splice(index, 1);
                        // 关键：彻底删除缓存文件
                        await this.plugin.persistence.deleteTaskContent(task.idea);
                        await this.plugin.savePluginData();
                        this.plugin.engine.updateStatusBar();
                        this.onOpen();
                    }
                })
            );
    }
}
