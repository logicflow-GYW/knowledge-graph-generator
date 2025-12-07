import { App, Modal, Setting, Notice, debounce } from 'obsidian';
import KnowledgeGraphPlugin from './main';
import { TaskData } from './types';

export class QueueManagementModal extends Modal {
    plugin: KnowledgeGraphPlugin;

    // 状态保持
    private searchTerms: { [key: string]: string } = {
        gen: '', rev: '', rep: '', dis: '',
    };
    
    private collapseStates: { [key: string]: boolean } = {
        gen: false, rev: false, rep: false, dis: false,
    };
    
    // 缓存列表容器的引用，以便局部刷新
    private listContainers: { [key: string]: HTMLElement } = {};
    
    // 防抖的刷新函数
    private refreshContent: () => void;

    constructor(app: App, plugin: KnowledgeGraphPlugin) {
        super(app);
        this.plugin = plugin;
        // 【修复】移除 immediate=true，使用默认的 trailing 模式。
        // 这确保了在一连串快速操作结束后，界面一定会刷新到最新状态，不会“丢单”。
        // 同时将 updateLists 绑定为刷新动作，而不是重建整个 Modal 的 onOpen。
        this.refreshContent = debounce(this.updateLists.bind(this), 200, false);
    }

    onOpen() {
        const { contentEl } = this;
        
        // 清理旧的监听器，防止重复注册
        this.app.workspace.off("kg-data-updated", this.refreshContent);

        contentEl.empty();
        contentEl.addClass('kg-modal'); 

        contentEl.createEl('h2', { text: 'Queue Management Dashboard' }); 

        this.renderHeader(contentEl);

        const queuesContainer = contentEl.createDiv('kg-queues-container');
        
        // 首次渲染各个区域的“骨架”
        this.renderQueueSection(queuesContainer, 'gen', 'Pending Generation', this.plugin.data.generationQueue, this.renderGenerationItem.bind(this));
        this.renderQueueSection(queuesContainer, 'rev', 'Pending Review', this.plugin.data.reviewQueue, this.renderReviewItem.bind(this));
        this.renderQueueSection(queuesContainer, 'rep', 'Pending Revision', this.plugin.data.revisionQueue, this.renderRevisionItem.bind(this));
        this.renderQueueSection(queuesContainer, 'dis', 'Discarded Pile', this.plugin.data.discardedPile, this.renderDiscardedItem.bind(this));
        
        // 底部维护工具
        new Setting(contentEl)
            .setName("Cache Maintenance")
            .setDesc("Clean up orphaned cache files that are no longer referenced by any task.")
            .addButton(btn => btn
                .setButtonText("Clean Cache")
                .onClick(async () => {
                    new Notice("Starting cleanup...");
                    const count = await this.plugin.persistence.cleanupOrphanedFiles();
                    new Notice(`Cleanup done. Removed ${count} files.`);
                })
            );

        // 注册监听，当后台数据变化时触发局部刷新
        this.app.workspace.on("kg-data-updated", this.refreshContent);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        this.app.workspace.off("kg-data-updated", this.refreshContent);
        this.listContainers = {};
    }

    // --- 核心修复：局部更新逻辑 ---
    // 不再重绘整个 Modal，只清空并重绘列表容器内部
    private updateLists() {
        const queueMap = {
            gen: { data: this.plugin.data.generationQueue, render: this.renderGenerationItem.bind(this) },
            rev: { data: this.plugin.data.reviewQueue, render: this.renderReviewItem.bind(this) },
            rep: { data: this.plugin.data.revisionQueue, render: this.renderRevisionItem.bind(this) },
            dis: { data: this.plugin.data.discardedPile, render: this.renderDiscardedItem.bind(this) }
        };

        for (const [key, config] of Object.entries(queueMap)) {
            const container = this.listContainers[key];
            if (container) {
                // 重新渲染列表内容，保持外层结构不变
                this.renderListContent(container, key as any, config.data, config.render);
                
                // 更新折叠面板标题上的计数
                // 向上查找 details 元素并更新 summary
                const details = container.closest('details');
                if (details) {
                    const summary = details.querySelector('summary');
                    if (summary) {
                        const titleBase = summary.getAttribute('data-title-base') || 'Queue';
                        // 重新计算过滤后的数量（可选）或者只显示总数，这里简单显示总数
                        summary.setText(`${titleBase} (${config.data.length})`);
                    }
                }
            }
        }
    }

    private renderHeader(containerEl: HTMLElement) {
        const status = this.plugin.data.status;
        const statusText = `Status: ${status.toUpperCase()}`;
        
        new Setting(containerEl)
            .setName(status === 'running' ? 'Engine Running' : 'Engine Paused')
            .setDesc(statusText)
            .addButton(button => button
                .setButtonText(status === 'running' ? 'Pause Engine' : 'Start Engine')
                .setCta(status !== 'running')
                .onClick(() => {
                    this.plugin.engine.toggleEngineState();
                    // 按钮状态改变需要重绘 Header，或者简单地重绘整个 Modal
                    this.onOpen(); 
                })
            );
    }

    private renderQueueSection(
        parentContainerEl: HTMLElement,
        key: 'gen' | 'rev' | 'rep' | 'dis',
        title: string,
        data: (string | TaskData)[],
        renderFn: (container: HTMLElement, item: string | TaskData, index: number, isSelected: boolean) => void
    ) {
        const sectionEl = parentContainerEl.createDiv('kg-queue-section');
        const details = sectionEl.createEl('details', { open: this.collapseStates[key] });
        
        const summary = details.createEl('summary');
        summary.addClass('kg-modal-summary');
        summary.setText(`${title} (${data.length})`);
        summary.setAttribute('data-title-base', title); // 存储基础标题方便更新

        details.addEventListener('toggle', () => {
            this.collapseStates[key] = details.open;
        });

        // 搜索框
        new Setting(details)
            .setHeading()
            .addText(text => {
                text.setPlaceholder('Filter...')
                    .setValue(this.searchTerms[key])
                    .onChange(debounce((value: string) => {
                        this.searchTerms[key] = value;
                        this.updateLists(); // 触发局部更新
                    }, 300));
            });

        // 列表容器
        const listContainer = details.createDiv('kg-list-container');
        listContainer.style.maxHeight = '300px';
        listContainer.style.overflowY = 'auto';
        
        // 保存引用，供 updateLists 使用
        this.listContainers[key] = listContainer;

        // 初始渲染内容
        this.renderListContent(listContainer, key, data, renderFn);
    }

    private renderListContent(
        container: HTMLElement,
        key: string,
        data: (string | TaskData)[],
        renderFn: (container: HTMLElement, item: string | TaskData, index: number, isSelected: boolean) => void
    ) {
        container.empty();
        
        const filter = this.searchTerms[key].toLowerCase();
        const filteredData = data.filter(item => {
            if (!filter) return true;
            const text = typeof item === 'string' ? item : item.idea;
            return text.toLowerCase().includes(filter);
        });

        // 简单的分页/限制显示数量，保证大量数据时的性能
        const displayLimit = 200; 
        const itemsToRender = filteredData.slice(0, displayLimit);

        if (itemsToRender.length === 0) {
            container.createEl('div', { 
                text: 'Queue is empty or no matches.', 
                cls: 'kg-queue-empty-msg', 
                style: 'padding: 10px; color: var(--text-muted); font-style: italic;' 
            });
            return;
        }

        itemsToRender.forEach((item, index) => {
            // 为每一项创建一个简单的容器
            const itemDiv = container.createDiv('kg-queue-item');
            // 传递 isSelected: false (暂时不实现批量选择，保持简单)
            renderFn(itemDiv, item, index, false);
        });

        if (filteredData.length > displayLimit) {
            container.createEl('div', { 
                text: `... showing first ${displayLimit} of ${filteredData.length} items. Use search to find specific items.`, 
                style: 'padding: 10px; text-align: center; color: var(--text-muted);'
            });
        }
    }

    // --- 渲染 Item 的逻辑保持不变 ---

    private renderGenerationItem(container: HTMLElement, item: string | TaskData, index: number, isSelected: boolean) {
        const itemName = typeof item === 'string' ? item : item.idea;
        new Setting(container)
            .setName(itemName)
            .addExtraButton(btn => btn
                .setIcon('trash')
                .setTooltip('Delete')
                .onClick(async () => {
                    const q = this.plugin.data.generationQueue;
                    const idx = q.indexOf(itemName);
                    if (idx > -1) {
                        q.splice(idx, 1);
                        await this.plugin.savePluginData();
                        this.plugin.engine.updateStatusBar();
                        this.refreshContent();
                    }
                })
            );
    }

    private renderReviewItem(container: HTMLElement, item: string | TaskData, index: number, isSelected: boolean) {
        const task = item as TaskData;
        new Setting(container)
            .setName(task.idea)
            .setDesc("Ready for review")
            .addExtraButton(btn => btn
                .setIcon('trash')
                .setTooltip('Discard')
                .onClick(async () => {
                    const q = this.plugin.data.reviewQueue;
                    const idx = q.indexOf(task);
                    if (idx > -1) {
                        q.splice(idx, 1);
                        this.plugin.data.discardedPile.push(task);
                        await this.plugin.savePluginData();
                        this.plugin.engine.updateStatusBar();
                        this.refreshContent();
                    }
                })
            );
    }

    private renderRevisionItem(container: HTMLElement, item: string | TaskData, index: number, isSelected: boolean) {
        const task = item as TaskData;
        new Setting(container)
            .setName(task.idea)
            .setDesc(`Reason: ${task.reason}`)
            .addExtraButton(btn => btn
                .setIcon('trash')
                .setTooltip('Discard')
                .onClick(async () => {
                    const q = this.plugin.data.revisionQueue;
                    const idx = q.indexOf(task);
                    if (idx > -1) {
                        q.splice(idx, 1);
                        this.plugin.data.discardedPile.push(task);
                        await this.plugin.savePluginData();
                        this.plugin.engine.updateStatusBar();
                        this.refreshContent();
                    }
                })
            );
    }

    private renderDiscardedItem(container: HTMLElement, item: string | TaskData, index: number, isSelected: boolean) {
        const task = item as TaskData;
        new Setting(container)
            .setName(task.idea)
            .setDesc(task.reason || 'Unknown')
            .addExtraButton(btn => btn
                .setIcon('refresh-cw')
                .setTooltip('Re-queue (for Generation)')
                .onClick(async () => {
                    // 重新排队逻辑
                    const q = this.plugin.data.discardedPile;
                    const idx = q.indexOf(task);
                    if (idx > -1) {
                        q.splice(idx, 1);
                        // 清除旧缓存以强制重新生成
                        await this.plugin.persistence.deleteTaskContent(task.idea);
                        this.plugin.engine.addConceptsToQueue([task.idea]);
                        
                        // 显式调用刷新，确保 UI 即时响应
                        this.refreshContent();
                    }
                })
            )
            .addExtraButton(btn => btn
                .setIcon('cross')
                .setTooltip('Delete Permanently')
                .onClick(async () => {
                    const q = this.plugin.data.discardedPile;
                    const idx = q.indexOf(task);
                    if (idx > -1) {
                        q.splice(idx, 1);
                        await this.plugin.persistence.deleteTaskContent(task.idea);
                        await this.plugin.savePluginData();
                        
                        // 显式调用刷新
                        this.refreshContent();
                    }
                })
            );
    }
}