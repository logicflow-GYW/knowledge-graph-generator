// src/types.ts

export interface KnowledgeGraphPluginSettings {
    // API 配置
    openai_api_keys: string;
    openai_base_url: string;
    openai_model: string;
    openai_backup_model: string;
    google_api_keys: string;
    google_model: string;
    google_backup_model: string;
    failover_cooldown_seconds: number;

    // 参数配置
    generation_temperature: number;
    generation_max_tokens: number;

    // 路径配置
    output_dir: string;

    // 系统配置
    generation_batch_size: number;
    request_delay: number;
    
    // 开发配置 (新增)
    debug_mode: boolean;

    // Critic 配置
    critic_mode: 'heuristic' | 'ai';
    critic_required_headers: string;
    critic_min_content_length: number;

    // Reviser 配置
    max_revision_retries: number;

    // Prompts
    prompt_generator: string;
    prompt_critic: string;
    prompt_reviser: string;

    // 概念播种箱
    seedConcepts: string;
    
    // 新概念提取
    extract_new_concepts: boolean;
}

export interface TaskData {
    idea: string;
    content?: string; // 修改：变为可选，持久化时不存入 JSON，而是存入文件
    reason?: string;
    retries?: number;
}

export interface PluginData {
    status: 'idle' | 'running' | 'paused';
    generationQueue: string[];
    reviewQueue: TaskData[];
    revisionQueue: TaskData[];
    discardedPile: TaskData[];
}

export interface KeyUsageStatus {
    fails: number;
    cooldown_until: number;
}