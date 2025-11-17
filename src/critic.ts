// critic.ts

import KnowledgeGraphPlugin from './main';
import { APIHandler } from './apiHandler';

export class Critic {
    private plugin: KnowledgeGraphPlugin;
    private apiHandler: APIHandler;

    constructor(plugin: KnowledgeGraphPlugin) {
        this.plugin = plugin;
        this.apiHandler = new APIHandler(plugin); // Critic can have its own handler if needed
    }

    public async judge(content: string): Promise<{ isApproved: boolean, reason: string }> {
        if (this.plugin.settings.critic_mode === 'ai') {
            return this._judgeByAI(content);
        }
        return this._judgeByHeuristic(content);
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
            
            // 【【【 已修复：添加 /i 标志，使其不区分大小写 】】】
            const reasonMatch = response.match(/\[REASON:\s*([^\]]+)\]/i);
            
            const isApproved = decisionMatch ? decisionMatch[1].toUpperCase() === 'KEEP' : false;
            const reason = reasonMatch ? reasonMatch[1].trim() : (isApproved ? "AI 批准" : "AI 拒绝，未提供明确理由");

            return { isApproved, reason };
        } catch (error) {
            console.error("AI Critic call failed:", error);
            return { isApproved: false, reason: `AI 审核器调用失败: ${error.message}` };
        }
    }
}
