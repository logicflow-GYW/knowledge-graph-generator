// settings.ts (已重构为 TypeScript)

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import KnowledgeGraphPlugin from './main';
import { KnowledgeGraphPluginSettings } from './types';
// 导入已清理的 Modal
import { QueueManagementModal } from './QueueModal';

// --- 默认 Prompts ---
const PROMPT_GENERATOR_DEFAULT = `# Role: 知识系统构建专家...`;
const PROMPT_CRITIC_DEFAULT = `# Role: 知识图谱质量审核员...`;
const PROMPT_REVISER_DEFAULT = `# 角色: 资深知识编辑与内容优化专家...`;

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
    
    // 参数
    generation_temperature: 0.7,
    generation_max_tokens: 4096,
    
    // 路径
    output_dir: "KnowledgeGraphNotes",
    
    // 系统
    generation_batch_size: 5,
    request_delay: 5,
    
    // Critic
    critic_mode: "heuristic",
    critic_required_headers: "# 🧠\n> \n## 💡 核心思想\n## 🎯 适用场景\n## 🛠️ 使用步骤/构成要素\n## 🚀 案例分析\n## 👍 优点 & 👎 缺点\n## 🔗 关联模型",
    critic_min_content_length: 400,
    
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

// --- 默认 Prompts 获取函数 ---
export async function getDefaultPrompts() {
    return {
        prompt_generator: PROMPT_GENERATOR_DEFAULT,
        prompt_critic: PROMPT_CRITIC_DEFAULT,
        prompt_reviser: PROMPT_REVISER_DEFAULT
    };
}

// --- 设置选项卡 ---
export class KGsSettingTab extends PluginSettingTab {
    plugin: KnowledgeGraphPlugin;

    constructor(app: App, plugin: KnowledgeGraphPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "知识图谱生成器 - 设置" });

        // --- 队列管理 ---
        new Setting(containerEl)
            .setName("引擎仪表盘")
            .setDesc("管理待生成、待审核和已丢弃的任务。")
            .addButton(button => button
                .setButtonText("打开队列管理器")
                .setCta()
                .onClick(() => {
                    // 使用导入的、干净的 Modal
                    new QueueManagementModal(this.app, this.plugin).open();
                })
            );

        // --- API 设置 ---
        new Setting(containerEl).setName("API 设置").setHeading();

        containerEl.createEl("h3", { text: "OpenAI" });
        new Setting(containerEl)
            .setName("OpenAI API Keys")
            .setDesc("每行一个 Key。插件将自动轮换和冷却使用。")
            .addTextArea(text => text
                .setPlaceholder("sk-...")
                .setValue(this.plugin.settings.openai_api_keys)
                .onChange(async (value) => {
                    this.plugin.settings.openai_api_keys = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("OpenAI Base URL")
            .setDesc("如果使用第三方代理，请在此处填入代理地址。")
            .addText(text => text
                .setPlaceholder("https://api.openai.com/v1")
                .setValue(this.plugin.settings.openai_base_url)
                .onChange(async (value) => {
                    this.plugin.settings.openai_base_url = value.trim();
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName("OpenAI Model (主模型)")
            .setDesc("输入你想使用的 OpenAI 主要模型名称。")
            .addText(text => text
                .setPlaceholder("gpt-4-turbo-preview")
                .setValue(this.plugin.settings.openai_model)
                .onChange(async (value) => {
                    this.plugin.settings.openai_model = value.trim();
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName("OpenAI 备用模型 (Backup Model)")
            .setDesc("(可选) 当主模型额度耗尽或失败时，将自动尝试此备用模型。")
            .addText(text => text
                .setPlaceholder("gpt-3.5-turbo")
                .setValue(this.plugin.settings.openai_backup_model)
                .onChange(async (value) => {
                    this.plugin.settings.openai_backup_model = value.trim();
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl("h3", { text: "Google Gemini" });
        new Setting(containerEl)
            .setName("Google Gemini API Keys")
            .setDesc("每行一个 Key。")
            .addTextArea(text => text
                .setPlaceholder("AIzaSy...")
                .setValue(this.plugin.settings.google_api_keys)
                .onChange(async (value) => {
                    this.plugin.settings.google_api_keys = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Google Gemini Model (主模型)")
            .setDesc("输入你想使用的 Google 主要模型名称。")
            .addText(text => text
                .setPlaceholder("gemini-1.5-pro-latest")
                .setValue(this.plugin.settings.google_model)
                .onChange(async (value) => {
                    this.plugin.settings.google_model = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Google Gemini 备用模型 (Backup Model)")
            .setDesc("(可选) 当主模型额度耗尽或失败时，将自动尝试此备用模型。")
            .addText(text => text
                .setPlaceholder("gemini-1.0-pro")
                .setValue(this.plugin.settings.google_backup_model)
                .onChange(async (value) => {
                    this.plugin.settings.google_backup_model = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Key 冷却时间 (秒)")
            .setDesc("API Key 失败后，需要等待多少秒才能再次使用。")
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
        new Setting(containerEl).setName("LLM 参数设置").setHeading();
        new Setting(containerEl)
            .setName("生成温度 (Temperature)")
            .setDesc("控制生成内容的随机性。较低的值（如 0.2）更具确定性，较高的值（如 0.8）更具创造性。")
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
            .setName("最大 Token 数 (Max Tokens)")
            .setDesc("API 一次调用允许生成的最大 Token 数量。")
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
        new Setting(containerEl).setName("引擎设置").setHeading();
        new Setting(containerEl)
            .setName("输出文件夹")
            .setDesc("所有生成的笔记将保存到此文件夹。")
            .addText(text => text
                .setPlaceholder("KnowledgeGraphNotes")
                .setValue(this.plugin.settings.output_dir)
                .onChange(async (value) => {
                    this.plugin.settings.output_dir = value.trim().replace(/\/$/, ""); // 移除末尾的 /
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("生成批处理大小")
            .setDesc("引擎每一轮从“待生成队列”中取出的任务数量。")
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
            .setName("每轮请求延迟 (秒)")
            .setDesc("引擎在处理完一个批次后，等待多少秒再开始下一个批次。")
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
            .setName("最大修正次数")
            .setDesc("一篇笔记在被放弃（移入 Discarded Pile）前，最多允许被修正的次数。")
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
            .setName("自动提取新概念 (Extract New Concepts)")
            .setDesc("开启后，将自动从已批准笔记的内容中提取 [[Wikilinks]] 作为新概念加入“待生成队列”。(默认关闭)")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.extract_new_concepts)
                .onChange(async (value) => {
                    this.plugin.settings.extract_new_concepts = value;
                    await this.plugin.saveSettings();
                })
            );

        // --- Critic 设置 ---
        new Setting(containerEl)
            .setName("审核模式 (Critic Mode)")
            .setDesc("选择内容审核的方式。启发式模式速度快且免费，但只检查格式；AI模式更智能，但会消耗API额度。")
            .addDropdown(dropdown => dropdown
                .addOption("heuristic", "启发式 (Heuristic)")
                .addOption("ai", "人工智能 (AI)")
                .setValue(this.plugin.settings.critic_mode)
                .onChange(async (value: 'heuristic' | 'ai') => {
                    this.plugin.settings.critic_mode = value;
                    await this.plugin.saveSettings();
                    this.display(); // 刷新设置页面以显示/隐藏相关选项
                }));

        if (this.plugin.settings.critic_mode === "heuristic") {
            new Setting(containerEl)
                .setName("启发式审核：必须的标题")
                .setDesc("在启发式模式下，检查笔记是否包含所有这些标题（每行一个）。")
                .addTextArea(text => {
                    text.setValue(this.plugin.settings.critic_required_headers)
                        .onChange(async (value) => {
                            this.plugin.settings.critic_required_headers = value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.style.height = "150px";
                });
            
            new Setting(containerEl)
                .setName("启发式审核：最小内容长度")
                .setDesc("在启发式模式下，笔记内容必须达到的最小字符数。")
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
        new Setting(containerEl).setName("概念播种 (Concept Seeding)").setHeading();
        new Setting(containerEl)
            .setName("概念播种箱")
            .setDesc("在此处粘贴或输入您想要生成初始笔记的概念列表，每行一个概念。")
            .addTextArea(text => {
                text.setPlaceholder("例如：\n第一性原理\n奥卡姆剃刀\n刻意练习\n...")
                    .setValue(this.plugin.settings.seedConcepts)
                    .onChange(async (value) => {
                        this.plugin.settings.seedConcepts = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.style.height = "200px";
            });
        
        new Setting(containerEl)
            .addButton(button => button
                .setButtonText("播种到待生成队列")
                .setCta()
                .onClick(async () => {
                    const rawText = this.plugin.settings.seedConcepts;
                    if (!rawText.trim()) {
                        new Notice("播种箱为空，无需操作。");
                        return;
                    }
                    const conceptsToSeed = [...new Set(
                        rawText.split("\n").map(line => line.trim()).filter(Boolean)
                    )];
                    
                    const addedCount = this.plugin.engine.addConceptsToQueue(conceptsToSeed);
                    const ignoredCount = conceptsToSeed.length - addedCount;

                    let noticeMessage = `成功添加 ${addedCount} 个新概念到队列。`;
                    if (ignoredCount > 0) {
                        noticeMessage += `\n${ignoredCount} 个概念因已存在或重复而被忽略。`;
                    }
                    new Notice(noticeMessage, 5000);

                    // 清空播种箱
                    this.plugin.settings.seedConcepts = "";
                    await this.plugin.saveSettings();
                    this.display(); // 刷新
                })
            );

        // --- Prompts 设置 ---
        new Setting(containerEl).setName("Prompts 设置").setHeading();
        
        new Setting(containerEl)
            .setName("生成 Prompt")
            .setDesc("用于生成新概念内容的 Prompt。")
            .addTextArea(text => {
                text.setValue(this.plugin.settings.prompt_generator)
                    .onChange(async (value) => {
                        this.plugin.settings.prompt_generator = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.style.height = "300px";
            });

        if (this.plugin.settings.critic_mode === "ai") {
            new Setting(containerEl)
                .setName("审核 Prompt (Critic)")
                .setDesc("用于 AI 模式下审核生成内容的 Prompt。")
                .addTextArea(text => {
                    text.setValue(this.plugin.settings.prompt_critic)
                        .onChange(async (value) => {
                            this.plugin.settings.prompt_critic = value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.style.height = "300px";
                });
        }
        
        new Setting(containerEl)
            .setName("修正 Prompt (Reviser)")
            .setDesc("用于修正被审核员拒绝内容的 Prompt。")
            .addTextArea(text => {
                text.setValue(this.plugin.settings.prompt_reviser)
                    .onChange(async (value) => {
                        this.plugin.settings.prompt_reviser = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.style.height = "300px";
            });
    }
}
