# Knowledge Graph Generator 🧠

> **Automatically generate, review, and revise knowledge notes to build your personal knowledge graph.**
>
> 自动生成、审核和修正知识笔记，为您构建一个不断自我扩展的个人知识图谱。

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/logicflow-GYW/knowledge-graph-generator?style=flat-square)](https://github.com/logicflow-GYW/knowledge-graph-generator/releases)
[![GitHub license](https://img.shields.io/github/license/logicflow-GYW/knowledge-graph-generator?style=flat-square)](https://github.com/logicflow-GYW/knowledge-graph-generator/blob/main/LICENSE)

---

## 📖 Introduction

This plugin acts as an automated engine that thinks, reviews, and expands your knowledge system. Simply provide a concept (seed), and it will automatically generate structured, deep notes around that concept. It then discovers new concepts within those notes and loops continuously, building a vast personal knowledge graph for you.

---

## ✨ Key Features

* **Automated Generation**: Automatically calls AI to generate structured knowledge notes based on your input concepts.
* **3-Stage Workflow**: Unique "Generator" -> "Critic" -> "Reviser" pipeline ensures high-quality content.
* **Smart Critic**: Built-in review modes ranging from fast formatting checks (Heuristic) to deep content analysis (AI Critic).
* **Self-Expansion**: Automatically extracts new `[[Wikilinks]]` from approved notes and adds them to the generation queue, creating an infinite loop of knowledge discovery.
* **Dual AI Engine & Failover**: Supports both **OpenAI** and **Google Gemini**. Automatically switches to backup models or providers if the primary one fails.
* **Queue Dashboard**: A complete control center to manage, search, and monitor all your generation tasks.

---

## 📥 Installation

Since this plugin is designed for advanced users and distributed independently, please install it using one of the following methods:

### Method 1: Using BRAT (Recommended)
This is the easiest way to install and keep the plugin updated.

1.  Install **BRAT** from the Obsidian Community Plugins (search for "BRAT").
2.  Open the command palette (Ctrl/Cmd+P) and run: `BRAT: Add a beta plugin for frozen versioning`.
3.  Paste the URL of this repository: `https://github.com/logicflow-GYW/knowledge-graph-generator`.
4.  Click **Add Plugin**.
5.  The plugin is now installed and can be enabled in the settings.

### Method 2: Manual Installation
1.  Download the `main.js`, `manifest.json`, and `styles.css` files from the [Latest Release](https://github.com/logicflow-GYW/knowledge-graph-generator/releases/latest) page.
2.  Go to your Obsidian vault folder: `.obsidian/plugins/`.
3.  Create a new folder named `knowledge-graph-generator`.
4.  Move the downloaded files into that folder.
5.  Reload Obsidian and enable the plugin in Community Plugins settings.

---

## ⚙️ Configuration

### 1. API Setup (Required)
Go to **Settings** -> **Knowledge Graph Generator**.
* **OpenAI / Google Gemini Keys**: Provide at least one valid API key.
* **Models**: Set your primary model (e.g., `gpt-4-turbo`, `gemini-1.5-pro`) and optionally a backup model for failover protection.

### 2. Output Directory
* Set the **Output folder** (default: `KnowledgeGraphNotes`) where the generated notes will be saved.

---

## 🚀 How to Use

1.  **Seed a Concept**:
    * **Option A**: Go to Settings -> "Concept Seeding", enter concepts (one per line), and click "Seed to queue".
    * **Option B**: Open any note and run command: `Add current note title to generation queue`.
2.  **Start the Engine**:
    * Click the **Brain Circuit** icon 🧠 on the left ribbon.
    * Or run command: `Start/pause knowledge graph generation`.
3.  **Manage**:
    * Open Settings and click **"Open queue manager"** to view the dashboard.
    * Monitor the status bar at the bottom right.

---

<div id="chinese-readme"></div>

# 🇨🇳 知识图谱生成器 (中文说明)

这不仅是一个笔记工具，更是一个能自动思考、审查和扩展您知识体系的自动化引擎。您只需提供一个概念，它就能围绕这个概念自动生成深度笔记，并从中发现新概念，不断循环，最终构建一个庞大而有深度的个人知识图谱。

## ✨ 核心功能

* **自动化笔记生成**：基于您提供的概念（“种子”），自动调用 AI 生成结构化的知识笔记。
* **三阶段工作流**：采用“生成”->“审核”->“修正”的自动化流程，确保笔记质量。
* **智能审稿 (Critic)**：内置两种审稿模式，从简单的格式检查到复杂的 AI 内容审查，应有尽有。
* **自我循环与扩展**：在审核通过的笔记中自动提取新的 `[[链接概念]]`，并将其添加回“待生成”队列，实现知识的无限扩展。
* **双 AI 引擎与故障切换**：同时支持 OpenAI 和 Google Gemini。支持主备模型切换（如 GPT-4 失败自动切 GPT-3.5），极大提升稳定性。
* **队列管理仪表盘**：提供一个完整的控制中心，让您随时查看、搜索和管理所有队列中的任务。

---

## 📥 安装方法

本项目作为独立开源项目分发，请使用以下方式安装：

### 方法 1：使用 BRAT 插件 (推荐)
这是最方便的安装和更新方式。

1.  在 Obsidian 社区插件市场中搜索并安装 **BRAT**。
2.  打开命令面板 (Ctrl/Cmd+P)，运行命令：`BRAT: Add a beta plugin for frozen versioning`。
3.  粘贴本仓库地址：`https://github.com/logicflow-GYW/knowledge-graph-generator`。
4.  点击 **Add Plugin**。
5.  安装完成后，在设置中启用本插件即可。

### 方法 2：手动安装
1.  从 [Latest Release (最新发布页)](https://github.com/logicflow-GYW/knowledge-graph-generator/releases/latest) 下载 `main.js`, `manifest.json`, `styles.css` 这三个文件。
2.  进入您的 Obsidian 库文件夹：`.obsidian/plugins/`。
3.  新建一个文件夹，命名为 `knowledge-graph-generator`。
4.  将下载的文件放入该文件夹中。
5.  重启 Obsidian，在“第三方插件”设置中启用即可。

---

## ⚙️ 核心配置

1.  **配置 API (必须)**：
    * 在插件设置中填入 OpenAI 或 Google Gemini 的 API Key。
    * 推荐配置“备用模型 (Backup Model)”，以防止主模型额度不足导致任务中断。
2.  **设置输出路径**：
    * 指定生成的笔记存放文件夹（默认为 `KnowledgeGraphNotes`）。

---

## 💡 使用流程

1.  **播种概念 (Input)**：
    * **批量添加**：在设置页面的“概念播种箱”输入多个概念，点击播种。
    * **单个添加**：在任意笔记中运行命令 `将当前笔记标题添加到生成队列`。
2.  **启动引擎 (Start)**：
    * 点击左侧边栏的 **脑电路 (Brain Circuit)** 图标。
    * 观察右下角状态栏，引擎将开始自动处理队列。
3.  **监控与管理 (Dashboard)**：
    * 在设置页面点击 **"打开队列管理器 (Open queue manager)"**，可以实时查看待生成、待审核、待修正的任务列表。

---

## 🔧 高级玩法 (Prompt Engineering)

本插件的三个核心 AI 角色（生成者、审核者、修正者）的系统提示词 (Prompt) 都是完全开放的。

* **生成者 (Generator)**: 定义笔记的结构和风格（建议要求 AI 使用 Markdown 标题和 Mermaid 图表）。
* **审核者 (Critic)**: 定义什么样的笔记才是“合格”的（如必须包含双向链接、必须有图表等）。
* **修正者 (Reviser)**: 当审核不通过时，指导 AI 如何修改笔记。

> 💡 **提示**：您可以在设置中自定义这些 Prompt，打造属于您个人风格的知识工厂。

---

## 📄 License

MIT License. Copyright (c) 2025 logicflow-GYW.
