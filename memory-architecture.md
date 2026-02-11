# Memory Architecture

## Overview

Agentic memory system that simulates human memory for NPC AI agents. Replaces the raw event log dump with a curated memory stream that feeds relevant context to the orchestrator (Gemini).

## Architecture

```
┌──────────────────────────────────────────────┐
│            ORCHESTRATOR PROMPT                │
│  persona + observation + retrieved memories   │
└──────────────┬───────────────────────────────┘
               │
  ┌────────────┴────────────────────────────┐
  │          MEMORY STREAM                  │
  │   flat array of MemoryEntry per NPC     │
  │                                         │
  │   types: observation, episode,          │
  │          reflection, fact               │
  │                                         │
  │   retrieval scored by:                  │
  │     recency + importance + relevance    │
  └────────────┬────────────────────────────┘
               │
  ┌────────────┴────────────────────────────┐
  │       REFLECTION ENGINE                 │
  │   triggers when cumulative importance   │
  │   exceeds threshold → asks Gemini for   │
  │   high-level insights from recent       │
  │   memories → stores back as reflections │
  └─────────────────────────────────────────┘
```

## Memory Types

| Type | What | Example |
|------|------|---------|
| **observation** | Something the NPC perceived | "Wolf appeared near the river" |
| **episode** | A personal experience/interaction | "Player helped me fight a wolf" |
| **reflection** | Synthesized insight from memories | "The player seems trustworthy" |
| **fact** | Learned world knowledge | "Wolves are dangerous at night" |

## Memory Entry

```typescript
interface MemoryEntry {
  id: string;
  content: string;           // natural language description
  type: "observation" | "episode" | "reflection" | "fact";
  timestamp: number;         // creation time
  lastAccessed: number;      // last retrieval time
  importance: number;        // 0-1 scale
  entities: string[];        // entity IDs involved
}
```

No embeddings, no vector DB. At <200 memories per NPC, keyword matching + recency + importance is sufficient and keeps it browser-friendly with zero dependencies.

## Retrieval Scoring

When the orchestrator needs context, retrieve top-N memories:

```
score = recency + importance + relevance

recency   = 0.995 ^ (hours since last access)    // exponential decay
importance = memory.importance                     // pre-scored 0-1
relevance  = keyword overlap(query, memory)        // normalized 0-1
```

Based on Stanford Generative Agents (Park et al. 2023) retrieval formula.

## What Gets Memorized

Not everything — only notable events cross the encoding threshold:

| Event | Memory Type | Trigger |
|-------|-------------|---------|
| Combat (attacked/was attacked) | observation | health change detected |
| Conversation with player | episode | chat action completed |
| Player helped/hurt NPC | episode | combat involving player |
| NPC health dropped below 30% | observation | health threshold check |
| Trade completed | episode | trade action completed |
| Reflection triggered | reflection | cumulative importance > threshold |

## Reflection

Reflections trigger when `importanceSinceLastReflection > threshold` (default 3.0). Piggybacks on existing API calls — no extra API cost most of the time.

Process:
1. Gather 10 most recent memories
2. Ask Gemini: "Given these experiences, what 2 insights can you draw?"
3. Store insights as `reflection` type memories with importance 0.8

Reflections create emergent personality: "I've noticed the player is friendly" shapes future decisions.

## Integration Points

1. **`src/ai/memoryStream.ts`** — new file: MemoryEntry, MemoryStream class
2. **`src/ai/api.ts`** — generatePrompt uses retrieved memories instead of raw eventLog
3. **`src/ai/npcAI.ts`** — AIController owns a MemoryStream, encodes events after actions
4. **`src/core/constants.ts`** — MEMORY_CONFIG constants

## Token Budget

```
Persona:                ~50 tokens
Current observation:    ~100 tokens
Retrieved memories (5): ~150 tokens  (30 tokens each)
Instructions:           ~100 tokens
────────────────────────────────────
Total:                  ~400 tokens  (same as current)
```

Memories replace the raw event log — no increase in API costs.

## What This Enables

- NPC remembers player helped them → becomes friendly over time
- NPC remembers being attacked at a location → avoids it or warns
- NPC develops personality through reflections → emergent behavior
- Conversations reference shared history → "Remember when we fought that wolf?"
- NPCs form opinions → "I don't trust that merchant"

## Design Principles

Per CLAUDE.md: simplicity and elegance.

- **No vector DB / embeddings** — keyword overlap sufficient at this scale
- **No external storage** — all in-memory
- **No inter-NPC memory sharing** — each NPC owns its stream
- **No procedural memory** — persona already covers this
- **Replace, don't add** — memories replace eventLog in prompts
