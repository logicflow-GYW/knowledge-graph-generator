// src/settings.ts

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import KnowledgeGraphPlugin from './main';
import { KnowledgeGraphPluginSettings } from './types';
import { QueueManagementModal } from './QueueModal';

// --- 默认 Prompts ---
const PROMPT_GENERATOR_DEFAULT = `# Role: 知识系统构建专家...`; // (此处保持原样，省略长文本以节省空间)
const PROMPT_CRITIC_DEFAULT = `# Role: 知识图谱质量审核员...`;
const PROMPT_REVISER_DEFAULT = `# Role: 资深知识编辑与内容优化专家...`;

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

// --- 默认 Prompts 获取函数 (移除 async) ---
export function getDefaultPrompts() {
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
        
        // 修改：使用 Setting.setHeading()
        new Setting(containerEl)
            .setName("Knowledge Graph Generator settings")
            .setHeading();

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
        new Setting(containerEl).setName("API settings").setHeading();

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
                .setPlaceholder("gemini-1.5-pro-latest")
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
            .setDesc("0.0 to 2.0 (Creative vs Deterministic).")
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
        new Setting(containerEl).setName("Engine settings").setHeading();
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
            .setDesc("Automatically add [[Wikilinks]] from approved notes to generation queue.")
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
                .addOption("ai", "Artificial Intelligence (AI)")
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
                    text.inputEl.addClass("kg-textarea-short"); // 使用 CSS 类
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
                text.setPlaceholder("First Principles\nOccam's Razor\n...")
                    .setValue(this.plugin.settings.seedConcepts)
                    .onChange(async (value) => {
                        this.plugin.settings.seedConcepts = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.addClass("kg-textarea-medium"); // 使用 CSS 类
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

                    // 清空播种箱
                    this.plugin.settings.seedConcepts = "";
                    await this.plugin.saveSettings();
                    this.display(); 
                })
            );

        // --- Prompts 设置 ---
        new Setting(containerEl).setName("Prompts settings").setHeading();
        
        new Setting(containerEl)
            .setName("Generator prompt")
            .setDesc("Prompt for generating new content.")
            .addTextArea(text => {
                text.setValue(this.plugin.settings.prompt_generator)
                    .onChange(async (value) => {
                        this.plugin.settings.prompt_generator = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.addClass("kg-textarea-tall"); // 使用 CSS 类
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
                    text.inputEl.addClass("kg-textarea-tall"); // 使用 CSS 类
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
                text.inputEl.addClass("kg-textarea-tall"); // 使用 CSS 类
            });
    }
}