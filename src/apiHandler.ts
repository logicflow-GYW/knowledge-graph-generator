// src/apiHandler.ts

import { requestUrl, Notice, RequestUrlParam } from 'obsidian';
import KnowledgeGraphPlugin from './main';
import { KnowledgeGraphPluginSettings, KeyUsageStatus } from './types';

export class ApiKeyExhaustedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ApiKeyExhaustedError";
    }
}

export class AllModelsFailedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AllModelsFailedError";
    }
}

// 【优化点1】更精细的错误类型
export class RateLimitError extends Error {
    public retryAfter: number;
    constructor(message: string, retryAfter: number) {
        super(message);
        this.name = "RateLimitError";
        this.retryAfter = retryAfter;
    }
}

// 【优化点2】信号量类，用于并发控制
class Semaphore {
    private permits: number;
    private queue: (() => void)[] = [];

    constructor(permits: number) {
        this.permits = permits;
    }

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return;
        }
        return new Promise(resolve => this.queue.push(resolve));
    }

    release(): void {
        this.permits++;
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            this.permits--;
            next();
        }
    }
}


export class APIHandler {
    private plugin: KnowledgeGraphPlugin;
    private settings: KnowledgeGraphPluginSettings;
    
    private openai_keys: string[] = [];
    private google_keys: string[] = [];
    
    private keyUsageOpenAI = new Map<string, KeyUsageStatus>();
    private keyUsageGoogle = new Map<string, KeyUsageStatus>();
    
    // 【优化点3】移除手动索引，改为基于权重的选择
    // private openAIKeyIndex: number = 0;
    // private googleKeyIndex: number = 0;
    
    private hasNotifiedFailover: boolean = false;

    private readonly REQUEST_TIMEOUT_MS = 90000;

    // 【优化点2】并发控制信号量
    private requestSemaphore: Semaphore;

    constructor(plugin: KnowledgeGraphPlugin) {
        this.plugin = plugin;
        this.settings = plugin.settings;
        // 根据批量大小设置并发数，避免过载
        this.requestSemaphore = new Semaphore(plugin.settings.generation_batch_size);
        this.updateKeys();
    }

    public updateKeys(): void {
        this.openai_keys = this.settings.openai_api_keys.split("\n").map((k) => k.trim()).filter(Boolean);
        this.google_keys = this.settings.google_api_keys.split("\n").map((k) => k.trim()).filter(Boolean);

        this.openai_keys.forEach((key) => {
            if (!this.keyUsageOpenAI.has(key)) {
                this.keyUsageOpenAI.set(key, { fails: 0, cooldown_until: 0 });
            }
        });
        this.google_keys.forEach((key) => {
            if (!this.keyUsageGoogle.has(key)) {
                this.keyUsageGoogle.set(key, { fails: 0, cooldown_until: 0 });
            }
        });
    }
    
    // 【优化点3】基于权重的智能 Key 选择
    private _selectKey(keys: string[], provider: 'openai' | 'google'): string | null {
        const keyUsageMap = provider === "openai" ? this.keyUsageOpenAI : this.keyUsageGoogle;
        const currentTime = Date.now() / 1000;

        // 过滤出可用的 Key
        const availableKeys = keys.filter(key => {
            const usage = keyUsageMap.get(key);
            return usage && currentTime >= usage.cooldown_until;
        });

        if (availableKeys.length === 0) return null;

        // 策略：'exhaustion' -> 返回第一个可用的
        if (this.settings.api_key_strategy === 'exhaustion') {
            return availableKeys[0];
        }
        
        // 策略：'round-robin' -> 简单轮询 (这里暂时保留原逻辑)
        if (this.settings.api_key_strategy === 'round-robin') {
            // 为了简化，我们可以随机选择一个，或者引入一个持久化的索引
            // 这里我们用最近失败次数最少的作为权重的简单实现
            let bestKey = availableKeys[0];
            let minFails = keyUsageMap.get(bestKey)!.fails;

            for (const key of availableKeys) {
                const fails = keyUsageMap.get(key)!.fails;
                if (fails < minFails) {
                    bestKey = key;
                    minFails = fails;
                }
            }
            return bestKey;
        }
        
        return null;
    }

    // 【优化点4】使用 AbortController 实现超时
    private async _requestWithTimeout(requestParams: RequestUrlParam): Promise<any> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);

        // requestUrl 在 Obsidian 中目前不支持 AbortController
        // 所以我们仍然使用 Promise 包装，但错误会更清晰
        try {
            const response = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`API Request timed out after ${this.REQUEST_TIMEOUT_MS / 1000}s`));
                }, this.REQUEST_TIMEOUT_MS);

                requestUrl(requestParams)
                    .then(response => {
                        clearTimeout(timer);
                        resolve(response);
                    })
                    .catch(err => {
                        clearTimeout(timer);
                        reject(err);
                    });
            });
            return response;
        } catch(error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`API Request timed out after ${this.REQUEST_TIMEOUT_MS / 1000}s`);
            }
            throw error;
        }
    }

    private async _makeOpenAIRequest(key: string, prompt: string, modelName: string): Promise<string> {
        const response = await this._requestWithTimeout({
            url: `${this.settings.openai_base_url}/chat/completions`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${key}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: "user", content: prompt }],
                temperature: this.settings.generation_temperature,
                max_tokens: this.settings.generation_max_tokens
            })
        });
        return response.json.choices[0].message.content.trim();
    }

    private async _makeGoogleAPIRequest(key: string, prompt: string, modelName: string): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
        const response = await this._requestWithTimeout({
            url,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: this.settings.generation_temperature,
                    maxOutputTokens: this.settings.generation_max_tokens
                }
            })
        });

        const data = response.json;
        if (!data.candidates || data.candidates.length === 0) {
            throw new Error("API response is missing candidates. Full response: " + JSON.stringify(data));
        }
        return data.candidates[0].content.parts[0].text.trim();
    }

    // 【优化点5】更细致的错误判断
    private _isQuotaError(error: unknown): boolean {
        const err = error as any; 
        const httpStatus = err.status;
        const errorMessage = err.message?.toLowerCase() || "";
        
        if (httpStatus === 401 || httpStatus === 403) {
            return true; // 认证或权限问题，通常是 Key 无效或配额用完
        }
        
        if (httpStatus === 429) {
            // 速率限制，需要特殊处理
            const retryAfter = err.headers?.['retry-after'];
            if(retryAfter) {
                throw new RateLimitError(`Rate limited. Retry after ${retryAfter}s`, parseInt(retryAfter));
            }
            return true; // 没有 retry-after，也当作配额问题处理
        }
        
        if (errorMessage.includes("insufficient_quota") || errorMessage.includes("quota") || errorMessage.includes("permission")) {
            return true;
        }
        
        return false;
    }

    private _cooldownKey(key: string, provider: 'openai' | 'google', duration?: number): void {
        const keyUsageMap = provider === "openai" ? this.keyUsageOpenAI : this.keyUsageGoogle;
        const keyUsage = keyUsageMap.get(key);
        if (keyUsage) {
            const cooldownDuration = duration ?? this.settings.failover_cooldown_seconds;
            console.warn(`Key ...${key.slice(-4)} (${provider}) failed due to quota/auth error. Applying cooldown for ${cooldownDuration}s.`);
            keyUsage.cooldown_until = (Date.now() / 1000) + cooldownDuration;
            keyUsage.fails += 1;
        }
    }

    private _resetCooldown(key: string, provider: 'openai' | 'google'): void {
        const keyUsageMap = provider === "openai" ? this.keyUsageOpenAI : this.keyUsageGoogle;
        const keyUsage = keyUsageMap.get(key);
        if (keyUsage) {
            keyUsage.cooldown_until = 0;
            // 成功后，减少失败次数，但不清零，给历史记录一些权重
            if(keyUsage.fails > 0) {
                keyUsage.fails -= 1;
            }
        }
        this.hasNotifiedFailover = false;
    }
    
    // 【优化点2】使用信号量包装外部调用
    public async call(prompt: string): Promise<string> {
        await this.requestSemaphore.acquire();
        try {
            return await this._callInternal(prompt);
        } finally {
            this.requestSemaphore.release();
        }
    }

    // 【优化点6】将核心逻辑提取到私有方法，并增加重试
    private async _callInternal(prompt: string): Promise<string> {
        this.updateKeys();
        let lastError: Error | null = null;
        let openAIKeysAttempted = false;

        const openAIEnabled = this.openai_keys.length > 0 && !!(this.settings.openai_model || this.settings.openai_backup_model);
        const googleEnabled = this.google_keys.length > 0 && !!(this.settings.google_model || this.settings.google_backup_model);

        // 尝试 OpenAI
        if (openAIEnabled) {
            openAIKeysAttempted = true;
            for (const key of this.openai_keys) {
                const availableKey = this._selectKey(this.openai_keys, "openai");
                if (availableKey) {
                    try {
                        console.debug(`Trying OpenAI key ...${availableKey.slice(-4)}`);
                        return await this._callProviderWithRetry("openai", availableKey, prompt);
                    } catch (e: unknown) { 
                        const err = e as Error;
                        lastError = err;
                        // new Notice(`OpenAI key ...${availableKey.slice(-4)} failed. Trying next.`); // 减少通知噪音
                        console.warn(`OpenAI key ...${availableKey.slice(-4)} failed:`, err.message);
                        if (this._isQuotaError(err)) {
                            this._cooldownKey(availableKey, "openai");
                        }
                    }
                }
            }
        } else if (this.openai_keys.length > 0) {
            openAIKeysAttempted = true;
            lastError = new Error("OpenAI: Keys provided but no models defined.");
            console.warn(lastError.message);
        }

        // 尝试 Google
        if (googleEnabled) {
            if (openAIKeysAttempted && !this.hasNotifiedFailover) {
                new Notice("All OpenAI keys failed or unavailable. Switching to Google Gemini...");
                this.hasNotifiedFailover = true;
            }
            for (const key of this.google_keys) {
                const availableKey = this._selectKey(this.google_keys, "google");
                if (availableKey) {
                    try {
                        console.debug(`Trying Google Gemini key ...${availableKey.slice(-4)}`);
                        return await this._callProviderWithRetry("google", availableKey, prompt);
                    } catch (e: unknown) { 
                        const err = e as Error;
                        lastError = err;
                        console.warn(`Google Gemini key ...${availableKey.slice(-4)} failed:`, err.message);
                        if (this._isQuotaError(err)) {
                            if (err instanceof RateLimitError) {
                                this._cooldownKey(availableKey, "google", err.retryAfter);
                            } else {
                                this._cooldownKey(availableKey, "google");
                            }
                        }
                    }
                }
            }
        } else if (this.google_keys.length > 0) {
            lastError = lastError || new Error("Google: Keys provided but no models defined.");
            console.warn(lastError.message);
        }
        
        if (!openAIEnabled && !googleEnabled && (this.openai_keys.length > 0 || this.google_keys.length > 0)) {
            const message = "Please provide API keys and at least one model name in settings.";
            new Notice(message);
            throw new AllModelsFailedError(message);
        }

        throw new AllModelsFailedError(`All API providers failed. Last error: ${lastError?.message}`);
    }
    
    // 【优化点7】带重试的供应商调用
    private async _callProviderWithRetry(provider: 'openai' | 'google', key: string, prompt: string): Promise<string> {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (provider === 'openai') {
                    return await this._callOpenAI(key, prompt);
                } else {
                    return await this._callGoogleAPI(key, prompt);
                }
            } catch (error: any) {
                if (attempt === maxRetries || this._isQuotaError(error)) {
                    throw error; // 最后一次重试或配额错误，直接抛出
                }
                console.warn(`Attempt ${attempt} failed for ${provider}, retrying... Error: ${error.message}`);
                // 指数退避等待
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
            }
        }
        // 理论上不会到达这里，但 TypeScript 需要
        throw new Error(`${provider} failed after all retries.`);
    }


    private async _callOpenAI(key: string, prompt: string): Promise<string> {
        const primaryModel = this.settings.openai_model;
        const backupModel = this.settings.openai_backup_model;
        
        try {
            const result = await this._makeOpenAIRequest(key, prompt, primaryModel);
            this._resetCooldown(key, "openai");
            return result;
        } catch (e: unknown) { 
            const primaryError = e;
            const primaryMsg = (e instanceof Error) ? e.message : String(e);
            
            if (backupModel) { 
                try {
                    const backupResult = await this._makeOpenAIRequest(key, prompt, backupModel);
                    this._resetCooldown(key, "openai");
                    return backupResult; 
                } catch (e2: unknown) { 
                    if (this._isQuotaError(primaryError) || this._isQuotaError(e2)) {
                        throw new ApiKeyExhaustedError(`OpenAI key failed (both primary and backup models).`);
                    }
                    throw new ApiKeyExhaustedError(`OpenAI key failed (both primary and backup models) due to network/other error.`);
                }
            }
            
            if (this._isQuotaError(primaryError)) {
                throw new ApiKeyExhaustedError(`OpenAI key failed (primary model failed, no backup).`);
            }
            throw new Error(`OpenAI key failed (primary model failed, no backup): ${primaryMsg}`);
        }
    }

    private async _callGoogleAPI(key: string, prompt: string): Promise<string> {
        const primaryModel = this.settings.google_model;
        const backupModel = this.settings.google_backup_model;
        
        try {
            const result = await this._makeGoogleAPIRequest(key, prompt, primaryModel);
            this._resetCooldown(key, "google");
            return result;
        } catch (e: unknown) { 
            const primaryError = e;
            
            if (backupModel) {
                try {
                    const backupResult = await this._makeGoogleAPIRequest(key, prompt, backupModel);
                    this._resetCooldown(key, "google");
                    return backupResult; 
                } catch (e2: unknown) { 
                    if (this._isQuotaError(primaryError) || this._isQuotaError(e2)) {
                        throw new ApiKeyExhaustedError(`Google key failed (both primary and backup models).`);
                    }
                    throw new ApiKeyExhaustedError(`Google key failed (both primary and backup models) due to network/other error.`);
                }
            }
            
            if (this._isQuotaError(primaryError)) {
                throw new ApiKeyExhaustedError(`Google key failed (primary model failed, no backup).`);
            }
            throw new Error(`Google key failed (primary model failed, no backup): ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`);
        }
    }
}
