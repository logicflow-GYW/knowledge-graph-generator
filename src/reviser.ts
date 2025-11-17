// reviser.ts

import KnowledgeGraphPlugin from './main';

export class Reviser {
    private plugin: KnowledgeGraphPlugin;

    constructor(plugin: KnowledgeGraphPlugin) {
        this.plugin = plugin;
    }

    public createRevisionPrompt(idea: string, originalContent: string, rejectionReason: string): string {
        let prompt = this.plugin.settings.prompt_reviser;
        prompt = prompt.replace('{concept}', idea);
        prompt = prompt.replace('{original_content}', originalContent);
        prompt = prompt.replace('{rejection_reason}', rejectionReason);
        return prompt;
    }
}
