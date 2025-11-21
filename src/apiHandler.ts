// src/apiHandler.ts

import { requestUrl, Notice } from 'obsidian';
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

export class APIHandler {
    private plugin: KnowledgeGraphPlugin;
    private settings: KnowledgeGraphPluginSettings;
    
    private openai_keys: string[] = [];
    private google_keys: string[] = [];
    
    private keyUsageOpenAI = new Map<string, KeyUsageStatus>();
    private keyUsageGoogle = new Map<string, KeyUsageStatus>();
    
    private hasNotifiedFailover: boolean = false;

    constructor(plugin: KnowledgeGraphPlugin) {
        this.plugin = plugin;
        this.settings = plugin.settings;
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

    private _selectKey(keys: string[], provider: 'openai' | 'google'): string | null {
        const keyUsageMap = provider === "openai" ? this.keyUsageOpenAI : this.keyUsageGoogle;
        const currentTime = Date.now() / 1000;

        for (const key of keys) {
            const usage = keyUsageMap.get(key);
            if (usage && currentTime >= usage.cooldown_until) {
                return key;
            }
        }
        return null;
    }

    private async _makeOpenAIRequest(key: string, prompt: string, modelName: string): Promise<string> {
        const response = await requestUrl({
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
        const response = await requestUrl({
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

    // Fixed: replaced 'any' with 'unknown' and strict type checking
    private _isQuotaError(error: unknown): boolean {
        const err = error as { status?: number; message?: string }; 
        const httpStatus = err.status;
        const errorMessage = err.message?.toLowerCase() || "";
        
        if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
            return true;
        }
        
        if (errorMessage.includes("insufficient_quota") || errorMessage.includes("rate limit") || errorMessage.includes("quota") || errorMessage.includes("permission") || errorMessage.includes("429")) {
            return true;
        }
        
        return false;
    }

    private _cooldownKey(key: string, provider: 'openai' | 'google'): void {
        const keyUsageMap = provider === "openai" ? this.keyUsageOpenAI : this.keyUsageGoogle;
        const keyUsage = keyUsageMap.get(key);
        if (keyUsage) {
            console.warn(`Key ...${key.slice(-4)} (${provider}) failed due to quota/auth error. Applying cooldown.`);
            keyUsage.cooldown_until = (Date.now() / 1000) + this.settings.failover_cooldown_seconds;
        }
    }

    private _resetCooldown(key: string, provider: 'openai' | 'google'): void {
        const keyUsageMap = provider === "openai" ? this.keyUsageOpenAI : this.keyUsageGoogle;
        const keyUsage = keyUsageMap.get(key);
        if (keyUsage) {
            keyUsage.cooldown_until = 0;
        }
        this.hasNotifiedFailover = false;
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
            
            console.warn(`OpenAI primary model '${primaryModel}' failed for key ...${key.slice(-4)}:`, primaryMsg);
            
            if (backupModel) { 
                try {
                    const backupResult = await this._makeOpenAIRequest(key, prompt, backupModel);
                    this._resetCooldown(key, "openai");
                    return backupResult; 
                } catch (e2: unknown) { 
                    const backupMsg = (e2 instanceof Error) ? e2.message : String(e2);
                    console.error(`OpenAI backup model '${backupModel}' also failed for key ...${key.slice(-4)}:`, backupMsg);
                    
                    if (this._isQuotaError(primaryError) || this._isQuotaError(e2)) {
                        this._cooldownKey(key, "openai");
                    }
                    throw new ApiKeyExhaustedError(`OpenAI key failed (both primary and backup models).`);
                }
            }
            
            if (this._isQuotaError(primaryError)) {
                this._cooldownKey(key, "openai");
            }
            throw new ApiKeyExhaustedError(`OpenAI key failed (primary model failed, no backup): ${primaryMsg}`);
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
            const primaryMsg = (e instanceof Error) ? e.message : String(e);
            console.warn(`Google primary model '${primaryModel}' failed for key ...${key.slice(-4)}:`, primaryMsg);
            
            if (backupModel) {
                try {
                    const backupResult = await this._makeGoogleAPIRequest(key, prompt, backupModel);
                    this._resetCooldown(key, "google");
                    return backupResult; 
                } catch (e2: unknown) { 
                    const backupMsg = (e2 instanceof Error) ? e2.message : String(e2);
                    console.error(`Google backup model '${backupModel}' also failed for key ...${key.slice(-4)}:`, backupMsg);
                    
                    if (this._isQuotaError(primaryError) || this._isQuotaError(e2)) {
                        this._cooldownKey(key, "google");
                    }
                    throw new ApiKeyExhaustedError(`Google key failed (both primary and backup models).`);
                }
            }
            
            if (this._isQuotaError(primaryError)) {
                this._cooldownKey(key, "google");
            }
            throw new ApiKeyExhaustedError(`Google key failed (primary model failed, no backup): ${primaryMsg}`);
        }
    }

    public async call(prompt: string): Promise<string> {
        this.updateKeys();
        let lastError: Error | null = null;
        let openAIKeysAttempted = false;

        const openAIEnabled = this.openai_keys.length > 0 && !!(this.settings.openai_model || this.settings.openai_backup_model);
        const googleEnabled = this.google_keys.length > 0 && !!(this.settings.google_model || this.settings.google_backup_model);

        if (openAIEnabled) {
            openAIKeysAttempted = true;
            for (let i = 0; i < this.openai_keys.length; i++) {
                const key = this._selectKey(this.openai_keys, "openai");
                if (key) {
                    try {
                        console.debug(`Trying OpenAI key ...${key.slice(-4)}`);
                        return await this._callOpenAI(key, prompt);
                    } catch (e: unknown) { 
                        const err = e as Error;
                        lastError = err;
                        new Notice(`OpenAI key ...${key.slice(-4)} failed. Trying next.`);
                    }
                }
            }
        } else if (this.openai_keys.length > 0) {
            openAIKeysAttempted = true;
            lastError = new Error("OpenAI: Keys provided but no models defined.");
            console.warn(lastError.message);
        }

        if (googleEnabled) {
            if (openAIKeysAttempted && !this.hasNotifiedFailover) {
                new Notice("All OpenAI keys failed or unavailable. Switching to Google Gemini...");
                this.hasNotifiedFailover = true;
            }
            for (let i = 0; i < this.google_keys.length; i++) {
                const key = this._selectKey(this.google_keys, "google");
                if (key) {
                    try {
                        console.debug(`Trying Google Gemini key ...${key.slice(-4)}`);
                        return await this._callGoogleAPI(key, prompt);
                    } catch (e: unknown) { 
                        const err = e as Error;
                        lastError = err;
                        new Notice(`Google Gemini key ...${key.slice(-4)} failed. Trying next.`);
                    }
                }
            }
        } else if (this.google_keys.length > 0) {
            lastError = lastError || new Error("Google: Keys provided but no models defined.");
            console.warn(lastError.message);
        }

        if (!openAIEnabled && !googleEnabled && (this.openai_keys.length > 0 || this.google_keys.length > 0)) {
            new Notice("Please provide API keys and at least one model name in settings.");
            throw new AllModelsFailedError("Keys provided but no models defined.");
        }

        throw new AllModelsFailedError(`All API providers failed. Last error: ${lastError?.message}`);
    }
}