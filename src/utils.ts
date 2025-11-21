// src/utils.ts

import { KnowledgeGraphPluginSettings } from './types';

export class Logger {
    private static isDebug: boolean = false;

    static setDebugMode(debug: boolean) {
        Logger.isDebug = debug;
    }

    static log(message: string, ...args: any[]) {
        if (Logger.isDebug) {
            console.log(`[KG-Gen] ${message}`, ...args);
        }
    }

    static warn(message: string, ...args: any[]) {
        console.warn(`[KG-Gen] ${message}`, ...args);
    }

    static error(message: string, ...args: any[]) {
        console.error(`[KG-Gen] ${message}`, ...args);
    }
}

export function sanitizeFilename(name: string): string {
    let cleanName = name.replace(/\s*\(.*\)/g, '').trim();
    cleanName = cleanName.replace(/[\\/*?:"<>|]/g, "");
    return cleanName.slice(0, 100);
}

export function extractNewIdeas(content: string): string[] {
    const matches = content.match(/\[\[([^\]]+)\]\]/g);
    if (!matches) {
        return [];
    }
    const ideas = matches.map(match => {
        return match.slice(2, -2).split('|')[0].trim();
    });
    return [...new Set(ideas)];
}

export function cleanMarkdownOutput(content: string): string {
    const trimmed = content.trim();
    if (trimmed.startsWith("```markdown") && trimmed.endsWith("```")) {
        let cleaned = trimmed.substring("```markdown".length, trimmed.length - "```".length);
        return cleaned.trim();
    }
    return trimmed;
}