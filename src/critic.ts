// src/critic.ts

import KnowledgeGraphPlugin from './main';
import { APIHandler } from './apiHandler';

export class Critic {
    private plugin: KnowledgeGraphPlugin;
    private apiHandler: APIHandler;

    constructor(plugin: KnowledgeGraphPlugin) {
        this.plugin = plugin;
        this.apiHandler = new APIHandler(plugin); 
    }

    public async judge(content: string): Promise<{ isApproved: boolean, reason: string }> {
        // 1. 第一道防线：始终先运行启发式审核 (免费、快速)
        // 策略：快速失败 (Fail Fast)。如果连基本格式都对不上，直接拒绝，节省 API Token。
        const heuristicResult = this._judgeByHeuristic(content);

        if (!heuristicResult.isApproved) {
            return {
                isApproved: false,
                reason: `[Heuristic] ${heuristicResult.reason}` // 标记来源，方便修正者定位
            };
        }

        // 2. 第二道防线：AI 深度审核
        // 只有当通过了启发式检查，且用户明确开启了 'ai' 模式时，才调用 API
        if (this.plugin.settings.critic_mode === 'ai') {
            return this._judgeByAI(content);
        }

        // 3. 如果是 'heuristic' 模式且已通过检查，直接返回通过
        return heuristicResult;
    }

    private _judgeByHeuristic(content: string): { isApproved: boolean, reason: string } {
        const reasons: string[] = [];
        const contentLower = content.toLowerCase();

        // 1. Check for required headers
        const requiredHeaders = this.plugin.settings.critic_required_headers
            .split('\n').map(h => h.trim().toLowerCase()).filter(Boolean);
        
        const missingHeaders = requiredHeaders.filter(h => !contentLower.includes(h));
        if (missingHeaders.length > 0) {
            reasons.push(`缺少必需的标题: ${missingHeaders.join(', ')}`);
        }

        // 2. Check for min length
        if (content.length < this.plugin.settings.critic_min_content_length) {
            reasons.push(`内容过短 (当前: ${content.length}, 要求: ${this.plugin.settings.critic_min_content_length})`);
        }

        // 3. Check for refusal patterns
        const refusalPatterns = ["作为一?个AI", "作为语言模型", "我不能", "我无法", "很抱歉"];
        for (const pattern of refusalPatterns) {
            if (new RegExp(pattern, 'i').test(content)) {
                reasons.push(`包含AI拒绝语 (匹配: '${pattern}')`);
                break;
            }
        }
        
        return {
            isApproved: reasons.length === 0,
            reason: reasons.length > 0 ? reasons.join('; ') : "通过所有启发式规则检查。"
        };
    }

    private async _judgeByAI(content: string): Promise<{ isApproved: boolean, reason: string }> {
        const prompt = this.plugin.settings.prompt_critic.replace('{content}', content);
        try {
            const response = await this.apiHandler.call(prompt);
            const decisionMatch = response.match(/DECISION:\s*(KEEP|DISCARD)/i);
            const reasonMatch = response.match(/\[REASON:\s*([^\]]+)\]/i);
            
            const isApproved = decisionMatch ? decisionMatch[1].toUpperCase() === 'KEEP' : false;
            const reason = reasonMatch ? reasonMatch[1].trim() : (isApproved ? "AI 批准" : "AI 拒绝，未提供明确理由");

            return { isApproved, reason };
        } catch (error: unknown) {
            console.error("AI Critic call failed:", error);
            const errMsg = error instanceof Error ? error.message : String(error);
            return { isApproved: false, reason: `AI 审核器调用失败: ${errMsg}` };
        }
    }
}