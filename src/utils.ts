// utils.ts (原始稳定版)

export function sanitizeFilename(name: string): string {
    // 移除括号及其内容
    let cleanName = name.replace(/\s*\(.*\)/g, '').trim();
    // 移除文件系统不允许的字符
    cleanName = cleanName.replace(/[\\/*?:"<>|]/g, "");
    // 限制长度
    return cleanName.slice(0, 100);
}

export function extractNewIdeas(content: string): string[] {
    const matches = content.match(/\[\[([^\]]+)\]\]/g);
    if (!matches) {
        return [];
    }
    // 从 [[Link|Alias]] 或 [[Link]] 中提取 "Link"
    const ideas = matches.map(match => {
        return match.slice(2, -2).split('|')[0].trim();
    });
    return [...new Set(ideas)]; // 返回去重后的结果
}

export function cleanMarkdownOutput(content: string): string {
    const trimmed = content.trim();
    if (trimmed.startsWith("```markdown") && trimmed.endsWith("```")) {
        let cleaned = trimmed.substring("```markdown".length, trimmed.length - "```".length);
        return cleaned.trim();
    }
    return trimmed;
}
