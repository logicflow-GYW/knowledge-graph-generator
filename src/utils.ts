// src/utils.ts

export class Logger {
    private static isDebug: boolean = false;

    static setDebugMode(debug: boolean) {
        Logger.isDebug = debug;
    }

    // Changed any[] to unknown[] to satisfy linter
    // Changed console.log to console.debug to satisfy linter
    static log(message: string, ...args: unknown[]) {
        if (Logger.isDebug) {
            console.debug(`[KG-Gen] ${message}`, ...args);
        }
    }

    static warn(message: string, ...args: unknown[]) {
        console.warn(`[KG-Gen] ${message}`, ...args);
    }

    static error(message: string, ...args: unknown[]) {
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