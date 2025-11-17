// types.ts

/**
 * 插件设置的数据结构，会被保存到 data.json 中
 */
export interface KnowledgeGraphPluginSettings {
    // API 配置
    openai_api_keys: string;
    openai_base_url: string;
    openai_model: string;
    openai_backup_model: string; // 【【【 已添加 】】】
    google_api_keys: string;
    google_model: string;
    google_backup_model: string; // 【【【 已添加 】】】
    failover_cooldown_seconds: number;

    // 参数配置
    generation_temperature: number;
    generation_max_tokens: number;

    // 路径配置
    output_dir: string;

    // 系统配置
    max_workers: number; // 并发数
    generation_batch_size: number;
    request_delay: number; // 每轮之间的延迟（秒）

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
    extract_new_concepts: boolean; // 【【【 已添加 】】】
}

/**
 * 单个任务的数据结构
 */
export interface TaskData {
    idea: string;
    content: string;
    reason?: string;
    retries?: number;
}

/**
 * 插件内部状态的数据结构，用于持久化任务队列
 */
export interface PluginData {
    status: 'idle' | 'running' | 'paused';
    generationQueue: string[];
    reviewQueue: TaskData[];
    revisionQueue: TaskData[];
    discardedPile: TaskData[];
}

/**
 * API Key 的使用状态
 */
export interface KeyUsageStatus {
    fails: number;
    cooldown_until: number; // timestamp in seconds
}
