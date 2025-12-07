// ... (existing interfaces)

export interface HistoryEntry {
    idea: string;
    finalStatus: 'Success' | 'Discarded' | 'Pending';
    reason?: string;
    lastUpdated: number; // Timestamp
}

export interface PluginData {
    status: 'idle' | 'running' | 'paused';
    generationQueue: string[];
    reviewQueue: TaskData[];
    revisionQueue: TaskData[];
    discardedPile: TaskData[];
    
    // 新增：历史记录数组
    history: HistoryEntry[]; 
}

// ... (rest of the file)
