// QueueModal.ts (V1.3 - 合并实时刷新功能)

import { App, Modal, Setting, Notice } from 'obsidian';
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
        gen: false, // 默认折叠
        rev: false, // 默认折叠
        rep: false, // 默认折叠
        dis: false, // 默认折叠
    };

    // 【【【 新增：用于绑定的刷新函数 】】】
    private refreshContent: () => void;

    constructor(app: App, plugin: KnowledgeGraphPlugin) {
        super(app);
        this.plugin = plugin;

        // 【【【 实时刷新修改：创建一个绑定的函数引用，用于刷新 】】】
        // 我们将复用 onOpen() 来刷新，因为它会保留 this.searchTerms 和 this.collapseStates 的状态
        this.refreshContent = this.onOpen.bind(this);
    }

    onOpen() {
        const { contentEl } = this;

        // 【【【 实时刷新修改：为了安全，先注销旧的监听器 】】】
        // 防止重复打开时注册多个监听器
        this.app.workspace.off("kg-data-updated", this.refreshContent);

        contentEl.empty();
        contentEl.addClass('kg-modal'); 
        contentEl.createEl('h2', { text: '队列管理仪表盘' });

        const status = this.plugin.data.status;
        const statusText = `状态: ${status.toUpperCase()} | ${this.plugin.statusBarEl.getText()}`;
        
        // 1. 状态和启停按钮
        new Setting(contentEl)
            .setName(status === 'running' ? '引擎运行中' : '引擎已暂停')
            .setDesc(statusText)
            .addButton(button => button
                .setButtonText(status === 'running' ? '暂停引擎' : '启动引擎')
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
            '待生成 (Generation)', 
            this.plugin.data.generationQueue,
            this.renderGenerationItem.bind(this)
        );
        
        this.renderQueueSection(
            contentEl,
            'rev',
            '待审核 (Review)',
            this.plugin.data.reviewQueue,
            this.renderReviewItem.bind(this)
        );
        
        this.renderQueueSection(
            contentEl,
            'rep',
            '待修正 (Revision)',
            this.plugin.data.revisionQueue,
            this.renderRevisionItem.bind(this)
        );
        
        this.renderQueueSection(
            contentEl,
            'dis',
            '已丢弃 (Discarded)',
            this.plugin.data.discardedPile,
            this.renderDiscardedItem.bind(this)
        );

        // 【【【 实时刷新修改：在 onOpen 的末尾, 注册新的监听器 】】】
        // 当引擎发送 'kg-data-updated' 信号时, 自动调用 this.refreshContent (也就是 onOpen)
        this.app.workspace.on("kg-data-updated", this.refreshContent);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        
        // 【【【 实时刷新修改：在 Modal 关闭时, 必须注销监听器 】】】
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
            return (item as TaskData).idea.toLowerCase().includes(needle);
        });

        const total = data.length;
        const filteredTotal = filteredData.length;
        const titleText = `${title} (${filteredTotal}${total !== filteredTotal ? ' / ' + total : ''} 项)`;

        // 2. 使用 <details> 元素创建可折叠区域
        const details = containerEl.createEl('details');
        details.open = this.collapseStates[key]; // 设置初始展开/折叠状态

        // 3. 标题 (现在是 <summary>，可以点击)
        const summary = details.createEl('summary', { text: titleText });
        summary.style.fontWeight = 'bold';
        summary.style.fontSize = 'var(--font-ui-large)';
        summary.style.cursor = 'pointer';
        summary.style.padding = '5px 0';

        // 4. 监听点击事件，保存状态
        details.addEventListener('toggle', () => {
            this.collapseStates[key] = details.open;
        });

        // 5. 搜索框 (放在 details 内部)
        new Setting(details)
            .setDesc(`搜索 ${title}...`)
            .addText(text => {
                text.setPlaceholder('输入关键词...')
                    .setValue(this.searchTerms[key])
                    .onChange(value => {
                        this.searchTerms[key] = value;
                        this.onOpen(); // 刷新 Modal
                    });
            });

        // 6. 截断数据并渲染
        const truncatedData = filteredData.slice(0, displayLimit);
        
        if (truncatedData.length === 0) {
            const desc = details.createEl('p', { text: '此队列为空，或未找到匹配项。', cls: 'setting-item-description' });
            desc.style.paddingLeft = '10px';
            return;
        }
        
        // 7. 列表容器 (放在 details 内部)
        const listContainer = details.createDiv('kg-list-container');
        listContainer.style.maxHeight = '200px'; 
        listContainer.style.overflowY = 'auto'; 
        listContainer.style.border = '1px solid var(--background-modifier-border)';
        listContainer.style.padding = '5px';
        listContainer.style.marginLeft = '10px'; // 缩进

        truncatedData.forEach((item, index) => {
            renderFn(listContainer, item, index);
        });

        // 8. 显示截断提示
        if (filteredData.length > displayLimit) {
            const truncatedInfo = details.createEl('p', { 
                text: `... 仅显示前 ${displayLimit} 项 (共 ${filteredData.length} 项)，请使用搜索查找更多。`,
                cls: 'setting-item-description'
            });
            truncatedInfo.style.paddingLeft = '10px';
        }
    }

    // --- 单项渲染函数 ---

    private renderGenerationItem(container: HTMLElement, item: string | TaskData) {
        new Setting(container)
            .setName(item as string)
            .addButton(btn => btn
                .setIcon('trash')
                .setTooltip('删除此概念')
                .onClick(async () => {
                    const queue = this.plugin.data.generationQueue;
                    const index = queue.indexOf(item as string);
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
            .setName(`[审核] ${task.idea}`)
            .addButton(btn => btn
                .setIcon('trash')
                .setTooltip('丢弃此任务')
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
            .setName(`[修正] ${task.idea}`)
            .setDesc(`原因: ${task.reason || '未知'}`)
            .addButton(btn => btn
                .setIcon('trash')
                .setTooltip('丢弃此任务')
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
            .setName(`[已丢弃] ${task.idea}`)
            .setDesc(`最后原因: ${task.reason || '未知'}`)
            .addButton(btn => btn
                .setIcon('refresh-cw')
                .setTooltip('重新排队 (放回生成队列)')
                .onClick(async () => {
                    this.plugin.data.discardedPile.splice(this.plugin.data.discardedPile.indexOf(task), 1);
                    this.plugin.engine.addConceptsToQueue([task.idea]); // 使用 engine 的方法
                    this.onOpen();
                })
            );
    }
}
