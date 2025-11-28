# Knowledge Graph Generator

**English / [中文说明](#chinese-readme)**

> Automatically generate, review, and revise knowledge notes to build your personal knowledge graph.

This plugin acts as an automated engine that thinks, reviews, and expands your knowledge system. Simply provide a concept (seed), and it will automatically generate structured, deep notes around that concept. It then discovers new concepts within those notes and loops continuously, building a vast personal knowledge graph for you.

## Key Features

* **Automated Generation**: Automatically calls AI to generate structured knowledge notes based on your input concepts.
* **3-Stage Workflow**: Unique "Generator" -> "Critic" -> "Reviser" pipeline ensures high-quality content.
* **Smart Critic**: Built-in review modes ranging from fast formatting checks (Heuristic) to deep content analysis (AI Critic).
* **Self-Expansion**: Automatically extracts new `[[Wikilinks]]` from approved notes and adds them to the generation queue, creating an infinite loop of knowledge discovery.
* **Dual AI Engine & Failover**: Supports both **OpenAI** and **Google Gemini**. Automatically switches to backup models or providers if the primary one fails.
* **Queue Dashboard**: A complete control center to manage, search, and monitor all your generation tasks.

---

<div id="chinese-readme"></div>

# 知识图谱生成器 (Knowledge Graph Generator)

**作者：Logos**

自动生成、审核和修正知识笔记，为您构建一个不断自我扩展的个人知识图谱 。

这不仅是一个笔记工具，更是一个能自动思考、审查和扩展您知识体系的自动化引擎。您只需提供一个概念，它就能围绕这个概念自动生成深度笔记，并从中发现新概念，不断循环，最终构建一个庞大而有深度的个人知识图谱。

---

## 核心功能

* **自动化笔记生成**：基于您提供的概念（“种子”），自动调用 AI 生成结构化的知识笔记 。
* **三阶段工作流**：采用“生成”->“审核”->“修正”的自动化流程，确保笔记质量 。
* **智能审稿 (Critic)**：内置两种审稿模式，从简单的格式检查到复杂的 AI 内容审查，应有尽有 。
* **自我循环与扩展**：在审核通过的笔记中自动提取新的 `[[链接概念]]`，并将其添加回“待生成”队列，实现知识的无限扩展。
* **双 AI 引擎与故障切换**：**【更新】** 同时支持 OpenAI 和 Google Gemini。不仅能在不同供应商（如 OpenAI -> Gemini）之间自动切换，还支持在同一供应商内部设置“备用模型”（如 GPT-4 失败后自动切换到 GPT-3.5），极大提升了健壮性。
* **队列管理仪表盘**：提供一个完整的控制中心，让您随时查看、搜索和管理所有队列中的任务 。
* **高度可定制化**：从输出目录 到每一个 AI 阶段的 Prompt，一切皆可配置。

---

## 🚀 快速上手 (Quick Setup)

### 1. 安装插件
1.  (在插件上架后) 从 Obsidian 社区插件市场搜索 "Knowledge Graph Generator" 并安装。
2.  在设置中启用本插件。

### 2. 配置 API 密钥 (必须)
本插件**必须**配置 AI API 密钥才能工作。

1.  打开 Obsidian **设置** -> **Knowledge Graph Generator**。
2.  在 **API 设置** 区域：
    * 填入您的 **OpenAI API Keys** 或 **Google Gemini API Keys** （可以两个都填，插件会优先使用 OpenAI，失败后自动切换到 Google）。
    * (可选) 如果您使用第三方代理，请填写 **OpenAI Base URL** 。
    * 选择您想使用的**主模型**，例如 `gpt-4-turbo-preview` 或 `gemini-1.5-pro-latest` 。
    * **【更新】** (强烈推荐) 填写 **OpenAI 备用模型** 和 **Google Gemini 备用模型**。当主模型失败时，插件会自动降级到备用模型，确保任务不中断。

### 3. (重要) 配置输出目录
* 在设置中的“**输出文件夹**” 选项中，指定一个您希望所有笔记生成在哪个文件夹，例如 `KnowledgeGraphNotes`。如果不存在，插件会自动创建 。

---

## 💡 核心使用流程 (How to Use)

### 1. 播种您的第一个概念
您需要先给引擎提供一些“原料”。

**方法 A：概念播种箱 (批量添加)**
1.  打开 Obsidian **设置** -> **Knowledge Graph Generator**。
2.  滚动到“**概念播种 (Concept Seeding)**”区域 。
3.  在“**概念播种箱**”文本框中，输入您感兴趣的概念列表，每行一个 。
    ```
    第一性原理
    奥卡姆剃刀
    刻意练习
    ```
4.  点击“**播种到待生成队列**”按钮 ，插件会自动将这些概念添加到“待生成 (Generation)”队列中。

**方法 B：使用命令 (单个添加)**
1.  在 Obsidian 中，打开命令面板 (Ctrl/Cmd + P)。
2.  运行 "Knowledge Graph Generator: **将当前笔记标题添加到生成队列**" 命令 。
3.  这会将您当前打开的笔记的标题（Basename）作为一个新概念添加到“待生成”队列 。

### 2. 启动引擎
万事俱备，现在启动自动化引擎。

* **方法一：** 点击 Obsidian 左侧栏的“**脑电路**” (Brain Circuit) 图标 。
* **方法二：** 打开命令面板 (Ctrl/Cmd + P)，运行 "Knowledge Graph Generator: **启动/暂停 知识图谱生成**" 命令 。

### 3. 观察与管理
* **状态栏：** 引擎启动后，您可以在 Obsidian 右下角的状态栏看到引擎状态和队列计数，例如：`KG: running | G:10 | C:2 | R:1 | Total:13` 。
* **仪表盘：** 随时回到插件设置，点击“**打开队列管理器**”按钮 ，可以打开“队列管理仪表盘” ，实时查看每个任务的状态。

---

## ⚙️ 理解工作流与核心设置

### 队列管理仪表盘 (Queue Dashboard)
这是您监控插件运行的核心。
* **待生成 (Generation):** 概念的“原料库”。引擎会从这里取出概念去生成笔记。
* **待审核 (Review):** 笔记已生成，等待“审稿人(Critic)”的审核。
* **待修正 (Revision):** “审稿人”认为笔记不合格，发到这里等待“修正者(Reviser)”进行修改。
* **已丢弃 (Discarded):** 如果一篇笔记被修正了太多次（可设置）仍然不合格，它会被丢到这里 。您可以手动将其重新排队 。

### 审稿模式 (Critic Mode)
这是本插件的质量控制核心。

* **启发式 (Heuristic) (默认)：**
    * **优点：** 免费、瞬时完成。
    * **缺点：** “傻瓜式”审核。它**只检查格式**，例如：笔记内容是否足够长？是否包含了所有必需的标题（如“核心思想”、“使用步骤”等）？
    * **适用：** 追求速度和节省成本的用户。

* **人工智能 (AI)：**
    * **优点：** 真正的“智能”审核。它会**额外调用一次 AI**（使用 `审核 Prompt`），让 AI 来判断“生成者”写的内容质量是否高、逻辑是否通顺、是否符合要求。
    * **缺点：** 会消耗 API 额度（因为多了一次 AI 调用）。
    * **适用：** 追求高质量内容的用户。

### Prompts 设置
本插件的三个核心 AI 角色（生成者、审核者、修正者）的系统提示词(Prompt)都是完全开放的 。您可以在设置中根据您的需求，修改它们的“人设”和要求，以生成最符合您风格的笔记。
* **生成 Prompt:** 用于生成新笔记。
* **审核 Prompt (Critic):** （仅在 AI 审稿模式下启用）用于判断笔记质量。
* **修正 Prompt (Reviser):** 用于在审核不通过时，重写笔记。