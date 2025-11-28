// src/settings.ts

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import KnowledgeGraphPlugin from './main';
import { KnowledgeGraphPluginSettings } from './types';
import { QueueManagementModal } from './QueueModal';
import { Logger } from './utils';

// ... (PROMPTS constants remain unchanged) ...
const PROMPT_GENERATOR_DEFAULT = `# Role
你是一位**深度的本质还原者**与**认知架构师**。
你的目标是为概念 \`{concept}\` 构建一张符合 Obsidian 视觉美学（适合手机阅读）且具有极高思维密度的知识卡片。

# 核心原则
1.  **第一性原理**：不堆砌名词，而是挖掘该概念底层的“动力学机制”。
2.  **极简视觉**：严格使用 Obsidian Callout 和 Mermaid。
3.  **标签规范**：**关键**。标题下方的标签必须符合 Obsidian 格式（例如：\`#认知科学 #博弈论\`），**井号与文字之间不能有空格**。
4.  **图谱生长**：**关键**。在正文中提到任何相关的、值得深入研究的高价值概念时，必须使用 \`[[WikiLinks]]\` 格式（例如：[[熵增定律]]）。
5.  **去除非Markdown内容**：不要输出 "Here is the content..." 等废话，直接输出笔记内容。

# 输出内容结构

### {concept}
#自动推导的主题 #本质定义

> [!QUOTE] ⚡ **核心隐喻**
> (不要用简单的比喻。请使用一个能揭示**动态机制**或**结构张力**的场景隐喻。限 50 字。)

#### Ⅰ. 系统建模
> [!NOTE] 💡 **深度解码**
> (揭示模型背后的系统动力学机制。此处必须包含至少 2 个相关的 [[WikiLink]] 概念。)

\`\`\`mermaid
graph TD
    A(核心要素) -->|正反馈/压力| B{关键节点}
    B -->|路径1| C[结果/现象]
    C -->|负反馈/调节| A
    B -->|路径2| D[系统崩溃/变异]
    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#ccf,stroke:#333,stroke-width:2px
\`\`\`

#### Ⅱ. 跨界传送门 (同构映射)

> [!EXAMPLE] 🚀 **迁移至 [意想不到的领域]**
> **场景：** (寻找结构完全相同的另一个领域，越跨界越好)
> **🔍 洞察：** (揭示两个看似无关领域背后的**数学/逻辑同构性**。尝试使用 1 个 [[WikiLink]]。)

#### Ⅲ. 边界与悖论 (辩证思考)

> [!WARNING] ⚠️ **认知边界**
>
>   * **失效盲区：** (该模型在什么极端条件下会失效)
>   * **核心悖论：** (内部是否存在自我矛盾？如“效率与公平的互斥”)

#### Ⅳ. 灵魂拷问 (内省)

> [!QUESTION] 🧘 **知行合一**
>
>   * **[博弈抉择]:** (设计一个没有标准答案、需要权衡利弊的决策场景)
>   * **[思维刺针]:** (一句话刺破用户可能的虚荣或认知惰性)

-----

**🏷️ 极简总结：** (一句深刻的、具有哲学意味的金句)`;

const PROMPT_CRITIC_DEFAULT = `# Role: 知识图谱质量审核员 (Knowledge Graph Auditor)

你正在审核一篇关于 "{concept}" 的 Obsidian 知识卡片。
该卡片必须严格遵循“本质还原者”的极简高密度风格。

## 审核清单 (Checklist)
1.  **结构完整性**：内容必须包含以下 Markdown 标题或 Callout：
    * \`> [!QUOTE] ⚡\` (核心隐喻)
    * \`#### Ⅰ. 系统建模\` (必须包含 Mermaid 图表)
    * \`#### Ⅱ. 跨界传送门\` (同构映射)
    * \`#### Ⅲ. 边界与悖论\`
    * \`#### Ⅳ. 灵魂拷问\`
2.  **Mermaid 语法检查**：
    * 必须包含 \`\`\`mermaid\` 代码块。
    * **关键**：图表方向必须是 \`graph TD\` (从上到下，适配手机竖屏)。
    * 检查是否存在破坏渲染的特殊字符（如未转义的括号）。
3.  **自动生长机制**：
    * 正文中**必须**包含至少 2 个 \`[[WikiLinks]]\` 格式的链接（例如 \`[[熵增]]\` 或 \`[[非连续性]]\`），用于图谱自动扩展。
4.  **纯净度**：
    * 必须是纯 Markdown 内容。
    * **严禁**出现 "好的，这是为您生成的..." 或 "Certainly..." 等 AI 闲聊语。

## 原始内容
{content}

---

## 输出指令 (严格遵守)
你必须输出且仅输出以下格式（用于正则提取）：

DECISION: [KEEP 或 DISCARD]
[REASON: 如果是 DISCARD，请用一句话简述具体原因，例如"Mermaid方向错误(需TD)"或"缺少[[WikiLink]]"]
\`\`\``;

const PROMPT_REVISER_DEFAULT = `# Role: 资深知识编辑与内容优化专家

你收到的任务是修正一篇关于 "{concept}" 的知识卡片。
这篇卡片在上一轮审核中被拒绝了。

## 拒绝原因
{rejection_reason}

## 原始草稿
{original_content}

## 修正任务
请根据拒绝原因，重新编写或调整上述内容。
1.  如果原因是 **"格式错误"** 或 **"缺少标题"**：请严格补充缺失的 \`> [!QUOTE]\`, \`#### Ⅰ. 系统建模\` 等结构。
2.  如果原因是 **"Mermaid方向错误"** 或 **"缺少 Mermaid"**：请重绘一个 \`graph TD\` (竖向流) 的系统图，确保适合手机阅读。
3.  如果原因是 **"缺少 WikiLink"**：请在正文的关键概念处添加 \`[[ ]]\`，确保至少有 2 个。
4.  如果原因是 **"包含 AI 废话"**：请删除所有开场白，只保留 Markdown 正文。

## 输出要求
* **直接输出修正后的完整 Markdown 内容**。
* 不要解释你修改了什么，不要输出 "Here is the revised version"。
* 保持“本质还原者”的高密度、极简风格。`;

// --- 默认设置 ---
export const DEFAULT_SETTINGS: KnowledgeGraphPluginSettings = {
    // API
    openai_api_keys: "",
    openai_base_url: "https://api.openai.com/v1",
    openai_model: "gpt-4-turbo-preview",
    openai_backup_model: "",
    google_api_keys: "",
    google_model: "gemini-1.5-pro-latest",
    google_backup_model: "",
    failover_cooldown_seconds: 300,
    
    // API 策略
    api_key_strategy: "exhaustion",
    
    // 参数
    generation_temperature: 0.7,
    generation_max_tokens: 4096,
    
    // 路径
    output_dir: "KnowledgeGraphNotes",
    
    // 系统
    generation_batch_size: 5,
    request_delay: 5,
    debug_mode: false,
    
    // Critic
    critic_mode: "heuristic",
    critic_required_headers: `> [!QUOTE] ⚡
#### Ⅰ. 系统建模
#### Ⅱ. 跨界传送门
#### Ⅲ. 边界与悖论
#### Ⅳ. 灵魂拷问`,
    critic_min_content_length: 200, 
    
    // Reviser
    max_revision_retries: 2,
    
    // Prompts
    prompt_generator: PROMPT_GENERATOR_DEFAULT,
    prompt_critic: PROMPT_CRITIC_DEFAULT,
    prompt_reviser: PROMPT_REVISER_DEFAULT,
    
    // 播种箱
    seedConcepts: "",
    
    // 新概念提取
    extract_new_concepts: false
};

export function getDefaultPrompts() {
    return {
        prompt_generator: PROMPT_GENERATOR_DEFAULT,
        prompt_critic: PROMPT_CRITIC_DEFAULT,
        prompt_reviser: PROMPT_REVISER_DEFAULT
    };
}

export class KGsSettingTab extends PluginSettingTab {
    plugin: KnowledgeGraphPlugin;

    constructor(app: App, plugin: KnowledgeGraphPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        
        // --- 队列管理 ---
        new Setting(containerEl)
            .setName("Engine dashboard") 
            .setDesc("Manage generation, review, and discarded tasks.")
            .addButton(button => button
                .setButtonText("Open queue manager") 
                .setCta()
                .onClick(() => {
                    new QueueManagementModal(this.app, this.plugin).open();
                })
            );

        // --- API 设置 ---
        new Setting(containerEl).setName("API").setHeading();

        // 【新增】策略选择设置
        new Setting(containerEl)
            .setName("API Key strategy")
            .setDesc("Select how the plugin cycles through your API keys.")
            .addDropdown(dropdown => dropdown
                .addOption("exhaustion", "Sequential (Exhaust one, then next)")
                .addOption("round-robin", "Round-Robin (Rotate after every request)")
                .setValue(this.plugin.settings.api_key_strategy)
                .onChange(async (value: 'exhaustion' | 'round-robin') => {
                    this.plugin.settings.api_key_strategy = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName("OpenAI").setHeading();
        
        new Setting(containerEl)
            .setName("OpenAI API keys") 
            .setDesc("One key per line.")
            .addTextArea(text => text
                .setPlaceholder("sk-...")
                .setValue(this.plugin.settings.openai_api_keys)
                .onChange(async (value) => {
                    this.plugin.settings.openai_api_keys = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("OpenAI base URL") 
            .setDesc("Proxy URL if applicable.")
            .addText(text => text
                .setPlaceholder("https://api.openai.com/v1")
                .setValue(this.plugin.settings.openai_base_url)
                .onChange(async (value) => {
                    this.plugin.settings.openai_base_url = value.trim();
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName("OpenAI model (primary)") 
            .setDesc("Primary model name.")
            .addText(text => text
                .setPlaceholder("gpt-4-turbo-preview")
                .setValue(this.plugin.settings.openai_model)
                .onChange(async (value) => {
                    this.plugin.settings.openai_model = value.trim();
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName("OpenAI backup model") 
            .setDesc("Used when primary fails.")
            .addText(text => text
                .setPlaceholder("gpt-3.5-turbo")
                .setValue(this.plugin.settings.openai_backup_model)
                .onChange(async (value) => {
                    this.plugin.settings.openai_backup_model = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName("Google Gemini").setHeading();
        
        new Setting(containerEl)
            .setName("Google Gemini API keys") 
            .setDesc("One key per line.")
            .addTextArea(text => text
                .setPlaceholder("AIzaSy...")
                .setValue(this.plugin.settings.google_api_keys)
                .onChange(async (value) => {
                    this.plugin.settings.google_api_keys = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Google Gemini model (primary)") 
            .setDesc("Primary model name.")
            .addText(text => text
                .setPlaceholder("gemini-1.5-pro")
                .setValue(this.plugin.settings.google_model)
                .onChange(async (value) => {
                    this.plugin.settings.google_model = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Google Gemini backup model") 
            .setDesc("Used when primary fails.")
            .addText(text => text
                .setPlaceholder("gemini-1.0-pro")
                .setValue(this.plugin.settings.google_backup_model)
                .onChange(async (value) => {
                    this.plugin.settings.google_backup_model = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Key cooldown (seconds)") 
            .setDesc("Wait time after key failure.")
            .addText(text => text
                .setValue(String(this.plugin.settings.failover_cooldown_seconds))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 0) {
                        this.plugin.settings.failover_cooldown_seconds = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // --- LLM 参数设置 ---
        new Setting(containerEl).setName("LLM parameters").setHeading();
        new Setting(containerEl)
            .setName("Generation temperature") 
            .setDesc("0.0 to 2.0 (creative vs deterministic).")
            .addText(text => text
                .setValue(String(this.plugin.settings.generation_temperature))
                .onChange(async (value) => {
                    const num = parseFloat(value);
                    if (!isNaN(num) && num >= 0 && num <= 2) {
                        this.plugin.settings.generation_temperature = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName("Max tokens") 
            .setDesc("Maximum tokens per response.")
            .addText(text => text
                .setValue(String(this.plugin.settings.generation_max_tokens))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.generation_max_tokens = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // --- 引擎设置 ---
        new Setting(containerEl).setName("Engine").setHeading();
        new Setting(containerEl)
            .setName("Output folder") 
            .setDesc("Notes will be saved here.")
            .addText(text => text
                .setPlaceholder("KnowledgeGraphNotes")
                .setValue(this.plugin.settings.output_dir)
                .onChange(async (value) => {
                    this.plugin.settings.output_dir = value.trim().replace(/\/$/, ""); 
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Generation batch size") 
            .setDesc("Number of tasks per cycle.")
            .addText(text => text
                .setValue(String(this.plugin.settings.generation_batch_size))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.generation_batch_size = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName("Request delay (seconds)") 
            .setDesc("Wait time between batches.")
            .addText(text => text
                .setValue(String(this.plugin.settings.request_delay))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 0) {
                        this.plugin.settings.request_delay = num;
                        await this.plugin.saveSettings();
                    }
                }));
        
        new Setting(containerEl)
            .setName("Debug mode")
            .setDesc("Enable to see verbose logs in console.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debug_mode)
                .onChange(async (value) => {
                    this.plugin.settings.debug_mode = value;
                    Logger.setDebugMode(value); // 实时生效
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName("Max revision retries") 
            .setDesc("Maximum attempts before discarding.")
            .addText(text => text
                .setValue(String(this.plugin.settings.max_revision_retries))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 0) {
                        this.plugin.settings.max_revision_retries = num;
                        await this.plugin.saveSettings();
                    }
                }));
        
        new Setting(containerEl)
            .setName("Extract new concepts") 
            .setDesc("Automatically add [[wikilinks]] from approved notes to generation queue.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.extract_new_concepts)
                .onChange(async (value) => {
                    this.plugin.settings.extract_new_concepts = value;
                    await this.plugin.saveSettings();
                })
            );

        // --- Critic 设置 ---
        new Setting(containerEl)
            .setName("Critic mode") 
            .setDesc("Heuristic (fast, formatting check) or AI (smart, content check).")
            .addDropdown(dropdown => dropdown
                .addOption("heuristic", "Heuristic")
                .addOption("ai", "Artificial intelligence (AI)")
                .setValue(this.plugin.settings.critic_mode)
                .onChange(async (value: 'heuristic' | 'ai') => {
                    this.plugin.settings.critic_mode = value;
                    await this.plugin.saveSettings();
                    this.display(); 
                }));

        if (this.plugin.settings.critic_mode === "heuristic") {
            new Setting(containerEl)
                .setName("Heuristic: required headers") 
                .setDesc("Notes must contain these headers (one per line).")
                .addTextArea(text => {
                    text.setValue(this.plugin.settings.critic_required_headers)
                        .onChange(async (value) => {
                            this.plugin.settings.critic_required_headers = value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.addClass("kg-textarea-short"); 
                });
            
            new Setting(containerEl)
                .setName("Heuristic: min content length") 
                .setDesc("Minimum character count.")
                .addText(text => text
                    .setValue(String(this.plugin.settings.critic_min_content_length))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num >= 0) {
                            this.plugin.settings.critic_min_content_length = num;
                            await this.plugin.saveSettings();
                        }
                    }));
        }

        // --- 概念播种 ---
        new Setting(containerEl).setName("Concept seeding").setHeading(); 
        new Setting(containerEl)
            .setName("Seed box") 
            .setDesc("Enter concepts here, one per line.")
            .addTextArea(text => {
                text.setPlaceholder("First principles\nOccam's razor\n...")
                    .setValue(this.plugin.settings.seedConcepts)
                    .onChange(async (value) => {
                        this.plugin.settings.seedConcepts = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.addClass("kg-textarea-medium"); 
            });
        
        new Setting(containerEl)
            .addButton(button => button
                .setButtonText("Seed to queue") 
                .setCta()
                .onClick(async () => {
                    const rawText = this.plugin.settings.seedConcepts;
                    if (!rawText.trim()) {
                        new Notice("Seed box is empty.");
                        return;
                    }
                    const conceptsToSeed = [...new Set(
                        rawText.split("\n").map(line => line.trim()).filter(Boolean)
                    )];
                    
                    const addedCount = this.plugin.engine.addConceptsToQueue(conceptsToSeed);
                    const ignoredCount = conceptsToSeed.length - addedCount;

                    let noticeMessage = `Added ${addedCount} concepts.`;
                    if (ignoredCount > 0) {
                        noticeMessage += `\n${ignoredCount} ignored (duplicate/existing).`;
                    }
                    new Notice(noticeMessage, 5000);

                    this.plugin.settings.seedConcepts = "";
                    await this.plugin.saveSettings();
                    this.display(); 
                })
            );

        // --- Prompts 设置 ---
        new Setting(containerEl).setName("Prompts").setHeading();
        
        new Setting(containerEl)
            .setName("Generator prompt") 
            .setDesc("Prompt for generating new content.")
            .addTextArea(text => {
                text.setValue(this.plugin.settings.prompt_generator)
                    .onChange(async (value) => {
                        this.plugin.settings.prompt_generator = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.addClass("kg-textarea-tall"); 
            });

        if (this.plugin.settings.critic_mode === "ai") {
            new Setting(containerEl)
                .setName("Critic prompt") 
                .setDesc("Prompt for AI content review.")
                .addTextArea(text => {
                    text.setValue(this.plugin.settings.prompt_critic)
                        .onChange(async (value) => {
                            this.plugin.settings.prompt_critic = value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.addClass("kg-textarea-tall"); 
                });
        }
        
        new Setting(containerEl)
            .setName("Reviser prompt") 
            .setDesc("Prompt for revising rejected content.")
            .addTextArea(text => {
                text.setValue(this.plugin.settings.prompt_reviser)
                    .onChange(async (value) => {
                        this.plugin.settings.prompt_reviser = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.addClass("kg-textarea-tall"); 
            });
    }
}