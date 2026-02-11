/* File: /src/ai/memoryStream.ts */
import { MEMORY_CONFIG } from "../core/constants";
import { sendToGemini } from "./api";

export type MemoryType = "observation" | "episode" | "reflection" | "fact";

export interface MemoryEntry {
  id: string;
  content: string;
  type: MemoryType;
  timestamp: number;
  lastAccessed: number;
  importance: number; // 0-1
  entities: string[]; // entity IDs/names involved
}

export class MemoryStream {
  memories: MemoryEntry[] = [];
  importanceSinceLastReflection: number = 0;
  private nextId: number = 0;

  add(
    content: string,
    type: MemoryType,
    importance: number,
    entities: string[] = []
  ): MemoryEntry {
    const now = Date.now();
    const entry: MemoryEntry = {
      id: `mem_${this.nextId++}`,
      content,
      type,
      timestamp: now,
      lastAccessed: now,
      importance: Math.max(0, Math.min(1, importance)),
      entities,
    };

    this.memories.push(entry);
    this.importanceSinceLastReflection += entry.importance;

    // Evict oldest low-importance memories when over capacity
    if (this.memories.length > MEMORY_CONFIG.maxMemories) {
      this.evict();
    }

    return entry;
  }

  retrieve(query: string, limit: number = MEMORY_CONFIG.retrieveLimit): MemoryEntry[] {
    if (this.memories.length === 0) return [];

    const now = Date.now();
    const queryTokens = this.tokenize(query);

    const scored = this.memories.map((memory) => {
      const hoursSinceAccess = (now - memory.lastAccessed) / 3_600_000;
      const recency = Math.pow(MEMORY_CONFIG.decayRate, hoursSinceAccess);
      const importance = memory.importance;
      const relevance = this.keywordOverlap(queryTokens, memory);

      return { memory, score: recency + importance + relevance };
    });

    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, limit);
    // Update lastAccessed for retrieved memories
    for (const { memory } of results) {
      memory.lastAccessed = now;
    }

    return results.map(({ memory }) => memory);
  }

  shouldReflect(): boolean {
    return (
      this.importanceSinceLastReflection >= MEMORY_CONFIG.reflectionThreshold &&
      this.memories.length >= 5
    );
  }

  async reflect(npcName: string): Promise<MemoryEntry[] | null> {
    if (!this.shouldReflect()) return null;

    const recent = this.memories
      .slice(-MEMORY_CONFIG.reflectionInputCount)
      .map((m) => `- ${m.content}`)
      .join("\n");

    const language = localStorage.getItem("selectedLanguageName") || "English";

    const prompt = `You are ${npcName}. Based on these recent experiences:
${recent}

What 2 high-level insights or opinions have you formed? Respond as JSON:
{"insights": ["insight 1 in ${language}", "insight 2 in ${language}"]}`;

    try {
      const response = await sendToGemini(prompt);
      if (!response) return null;

      const parsed = JSON.parse(response);
      const insights: string[] = parsed.insights || [];

      this.importanceSinceLastReflection = 0;

      const newMemories: MemoryEntry[] = [];
      for (const insight of insights.slice(0, 2)) {
        const entry = this.add(insight, "reflection", 0.8);
        newMemories.push(entry);
      }
      return newMemories;
    } catch {
      return null;
    }
  }

  formatForPrompt(memories: MemoryEntry[]): string {
    if (memories.length === 0) return "No significant memories.";
    return memories
      .map((m) => {
        const age = this.formatAge(m.timestamp);
        return `- [${age}] ${m.content}`;
      })
      .join("\n");
  }

  private evict(): void {
    // Sort by importance (ascending) then by age (oldest first)
    const sorted = [...this.memories].sort((a, b) => {
      if (a.type === "reflection" && b.type !== "reflection") return 1; // keep reflections
      if (b.type === "reflection" && a.type !== "reflection") return -1;
      const importanceDiff = a.importance - b.importance;
      if (Math.abs(importanceDiff) > 0.1) return importanceDiff;
      return a.timestamp - b.timestamp;
    });

    // Remove least valuable entries to get back under limit
    const toRemove = this.memories.length - MEMORY_CONFIG.maxMemories;
    const removeIds = new Set(sorted.slice(0, toRemove).map((m) => m.id));
    this.memories = this.memories.filter((m) => !removeIds.has(m.id));
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 2);
  }

  private keywordOverlap(queryTokens: string[], memory: MemoryEntry): number {
    if (queryTokens.length === 0) return 0;

    const memoryText = `${memory.content} ${memory.entities.join(" ")}`.toLowerCase();
    const memoryTokens = new Set(this.tokenize(memoryText));

    // Also check entity names directly
    const entitySet = new Set(memory.entities.map((e) => e.toLowerCase()));

    let matches = 0;
    for (const token of queryTokens) {
      if (memoryTokens.has(token) || entitySet.has(token)) {
        matches++;
      }
    }

    return matches / queryTokens.length; // normalized 0-1
  }

  private formatAge(timestamp: number): string {
    const seconds = (Date.now() - timestamp) / 1000;
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }
}
