/* File: /src/ai/api.ts */
// File: src/ai/api.ts
import { Vector3, Object3D } from "three";
import { Entity } from "../entities/entitiy";
import { Character } from "../entities/character";
import { Animal } from "../entities/animals";
import { AIController } from "./npcAI"; // Import AIController for type hinting
import { InteractionSystem } from "../systems/interaction"; // Import InteractionSystem for type hinting
import { InventoryItem } from "../core/utils"; // Import InventoryItem

import { GEMINI_MODEL, GEMINI_API_BASE } from "../core/constants";

// --- API Key Management ---
const API_KEY1 = import.meta.env.VITE_GEMINI_API_KEY1;
const API_KEY2 = import.meta.env.VITE_GEMINI_API_KEY2;
let switched = false;

let currentApiKey = API_KEY1 || "";
let API_URL = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${currentApiKey}`;

function switchApiKey(): void {
  if (currentApiKey === API_KEY1) {
    currentApiKey = API_KEY2;
    console.log("Switched to VITE_GEMINI_API_KEY2 due to rate limit.");
  } else if (currentApiKey === API_KEY2) {
    currentApiKey = API_KEY1;
    console.log("Switched back to VITE_GEMINI_API_KEY1.");
  } else {
    console.warn("No alternate API key available for rotation.");
  }
  API_URL = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${currentApiKey}`;
}

// --- Gemini API Call ---
export async function sendToGemini(prompt: string): Promise<string | null> {
  if (!currentApiKey) {
    console.warn("VITE_GEMINI_API_KEY is not configured.");
    return null;
  }
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    if (!response.ok) {
      if (response.status === 429 && !switched) {
        console.warn(`Rate limit hit (429). Switching API key...`);
        switchApiKey();
        switched = true;
      }
      console.error(`HTTP error! status: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error("Error during API call:", error);
    return JSON.stringify({ action: "idle", intent: "Error fallback" });
  }
}

// --- Observation Structure ---
export interface Observation {
  timestamp: number;
  self: {
    id: string;
    position: Vector3;
    health: number;
    isDead: boolean;
    currentAction: string;
    inventory: Array<InventoryItem | null>; // Add inventory to observation
  };
  nearbyCharacters: Array<{
    id: string;
    position: Vector3;
    health: number;
    isDead: boolean;
    currentAction: string;
    inventory?: Array<InventoryItem | null>; // Optionally observe others' inventories
  }>;
  nearbyAnimals: Array<{
    id: string;
    type: string;
    position: Vector3;
    health: number;
    isDead: boolean;
    isAggressive: boolean;
    currentAction: string;
  }>;
  nearbyObjects: Array<{
    id: string;
    type: string;
    position: Vector3;
    isInteractable: boolean;
    resource?: string;
    health?: number; // Add health for resources
  }>;
}

// --- Observation Update Logic ---
export function updateObservation(
  controller: AIController,
  allEntities: Array<any>
): void {
  controller.lastObservation = structuredClone(controller.observation)
    ? JSON.parse(JSON.stringify(controller.observation))
    : null;
  const nearbyCharacters: Observation["nearbyCharacters"] = [];
  const nearbyAnimals: Observation["nearbyAnimals"] = [];
  const nearbyObjects: Observation["nearbyObjects"] = [];
  const selfPosition = controller.character.mesh!.position;
  const searchRadiusSq = controller.searchRadius * controller.searchRadius;
  const self: Observation["self"] = {
    id: controller.character.id,
    position: selfPosition.clone(),
    health: controller.character.health,
    isDead: controller.character.isDead,
    currentAction: controller.aiState,
    inventory: controller.character.inventory?.items ?? [], // Include self inventory
  };
  for (const entity of allEntities) {
    if (entity === controller.character || entity === controller.character.mesh)
      continue;
    const entityMesh =
      entity instanceof Entity || entity instanceof Object3D
        ? ((entity as any).mesh ?? entity)
        : null;
    if (!entityMesh || !entityMesh.parent) continue;
    const entityPosition = entityMesh.position;
    const distanceSq = selfPosition.distanceToSquared(entityPosition);
    if (distanceSq > searchRadiusSq) continue;
    if (entity instanceof Character) {
      nearbyCharacters.push({
        id: entity.id,
        position: entityPosition.clone(),
        health: entity.health,
        isDead: entity.isDead,
        currentAction:
          entity.aiController?.aiState ||
          (entity === controller.character.game?.activeCharacter
            ? "player_controlled"
            : entity.isDead
              ? "dead"
              : "unknown"),
        // Optionally include nearby character inventories if needed for complex AI
        // inventory: entity.inventory?.items ?? [],
      });
    } else if (entity instanceof Animal) {
      nearbyAnimals.push({
        id: entity.id,
        type: entity.animalType,
        position: entityPosition.clone(),
        health: entity.health,
        isDead: entity.isDead,
        isAggressive:
          typeof entity.userData.isAggressive === "boolean"
            ? entity.userData.isAggressive
            : false,
        currentAction: entity.aiController?.aiState || "unknown",
      });
    } else if (entity.userData?.isInteractable && entity.visible) {
      // Include resource objects
      nearbyObjects.push({
        id: entity.userData.id || entity.uuid,
        type: entity.name || "unknown",
        position: entityPosition.clone(),
        isInteractable: entity.userData.isInteractable,
        resource: entity.userData.resource,
        health: entity.userData.health, // Include health if available
      });
    }
  }
  controller.observation = {
    timestamp: Date.now(),
    self,
    nearbyCharacters,
    nearbyAnimals,
    nearbyObjects,
  };
}

// --- Prompt Generation Logic ---
export function generatePrompt(controller: AIController): string {
  const persona = controller.persona;
  const observation = controller.observation;
  const eventLog = controller.character.eventLog.entries
    .slice(-10)
    .map((entry) => `[${entry.timestamp}] ${entry.message}`)
    .join("\n");

  // Format inventory for the prompt
  const formatInventory = (inv: Array<InventoryItem | null>): string => {
    if (!inv || inv.every((item) => item === null)) return "Empty";
    return inv
      .filter((item): item is InventoryItem => item !== null)
      .map((item) => `${item.id} (${item.count})`)
      .join(", ");
  };

  const selfState = observation?.self
    ? `- Health: ${observation.self.health}\n- Current action: ${observation.self.currentAction}\n- Inventory: ${formatInventory(observation.self.inventory)}`
    : "Unknown";

  let nearbyCharacters = observation?.nearbyCharacters.length
    ? observation.nearbyCharacters
        .map(
          (c) =>
            `- ${c.id} at (${c.position.x.toFixed(1)}, ${c.position.y.toFixed(
              1
            )}, ${c.position.z.toFixed(1)}), health: ${c.health}, ${
              c.isDead ? "dead" : "alive"
            }, action: ${c.currentAction}`
          // Optionally add inventory: ${formatInventory(c.inventory)}
        )
        .join("\n")
    : "None";
  let nearbyAnimals = observation?.nearbyAnimals.length
    ? observation.nearbyAnimals
        .map(
          (a) =>
            `- ${a.type} (${a.id}) at (${a.position.x.toFixed(
              1
            )}, ${a.position.y.toFixed(1)}, ${a.position.z.toFixed(1)}), ${
              a.isDead ? "dead" : "alive"
            }, ${a.isAggressive ? "aggressive" : "passive"}, action: ${
              a.currentAction
            }`
        )
        .join("\n")
    : "None";
  let nearbyObjects = "None";
  if (observation?.nearbyObjects?.length) {
    const typeCounts: Record<string, number> = {};
    const limitedObjects = observation.nearbyObjects.filter((o) => {
      const type = o.type;
      typeCounts[type] = typeCounts[type] || 0;
      if (typeCounts[type] < 3) {
        typeCounts[type]++;
        return true;
      }
      return false;
    });
    if (limitedObjects.length > 0) {
      nearbyObjects = limitedObjects
        .map(
          (o) =>
            `- ${o.type} (${o.id}) at (${o.position.x.toFixed(
              1
            )}, ${o.position.y.toFixed(1)}, ${o.position.z.toFixed(1)}${
              o.resource ? ", resource: " + o.resource : ""
            }${
              o.health !== undefined ? ", health: " + o.health : "" // Show resource health
            }`
        )
        .join("\n");
    }
  }

  // Get language from localStorage or default to 'en'
  const language = localStorage.getItem("selectedLanguageName") || "English";

  const prompt = `
You are controlling an NPC named ${controller.character.id} in a game. Here is your persona:
${persona}

Your current state:
${selfState}

Here are your recent observations:
Nearby characters:
${nearbyCharacters}

Nearby animals:
${nearbyAnimals}

Nearby objects:
${nearbyObjects}

Here are the recent events you are aware of:
${eventLog}

Based on this information, decide your next action. If player told you to do something don't ask for clarification or guidance, just do it.
Attack target to gather resource. Trade to give or receive item from target. Follow target to stay close to them.

Respond ONLY with a valid JSON object using one of the following formats:

1. Attack:
{
  "action": "attack",
  "target_id": "target_entity_or_resource_id_here",
  "intent": "brief reason in ${language}"
}

2. Chat:
{
  "action": "chat",
  "target_id": "target_character_id_here",
  "message": "message_here in ${language}",
  "intent": "brief reason in ${language}"
}

3. Trade:
{
  "action": "trade",
  "target_id": "target_character_id_here",
  "give_items": [{"id": "item_id", "count": quantity}],
  "receive_items": [{"id": "item_id", "count": quantity}],
  "intent": "brief reason for trade in ${language}"
}

4. Follow:
{
  "action": "follow",
  "target_id": "target_character_id_here",
  "intent": "brief reason for following in ${language}"
}

Choose only ONE action format. Ensure item IDs in trade are valid (e.g., 'wood', 'stone', 'herb', 'meat', 'potion', 'axe', 'pickaxe', 'sword', 'coin').
Intent should be less than 10 words, response only in ${language}.

`.trim();
  return prompt;
}

// --- Chat Prompt Generation ---
export function generateChatPrompt(
  target: Character,
  initiator: Character,
  initiatorMessage: string
): string {
  const recentEvents = target.eventLog.entries
    .slice(-5)
    .map((entry) => entry.message)
    .join("\n");
  const persona = target.persona || "a friendly villager";

  // Get language from localStorage or default to 'en'
  const language = localStorage.getItem("selectedLanguage") || "en";

  return `
You are an NPC named ${target.name} with the following persona: ${persona}
The character named ${initiator.name} just said to you: "${initiatorMessage}"

Recent events observed by you:
${recentEvents || "Nothing significant recently."}

Respond to the character in brief max 20 words as a JSON object like {"response": "Your response here in ${language} "}.

`.trim();
}

export async function handleChatResponse(
  target: Character,
  initiator: Character,
  message: string
): Promise<void> {
  if (!(target instanceof Character) || !target.aiController) return;

  const prompt = generateChatPrompt(target, initiator, message);
  try {
    const responseJson = await sendToGemini(prompt);
    let npcMessage = "Hmm....";
    if (responseJson) {
      try {
        const parsedText = JSON.parse(responseJson);
        npcMessage =
          parsedText.response?.trim() || responseJson.trim() || "Hmm....";
      } catch (parseError) {
        npcMessage = responseJson.trim() || "Hmm....";
        console.log(
          "Chat response was not JSON, treating as string:",
          responseJson
        );
      }
    }
    target.updateIntentDisplay(npcMessage);
    if (target.game) {
      target.game.logEvent(
        target,
        "chat",
        `${target.name} said "${npcMessage}" to ${initiator.name}.`,
        initiator,
        { message: npcMessage },
        target.mesh!.position
      );
    }

    if (target.aiController) {
      target.aiController.scheduleNextActionDecision();
    }
  } catch (error) {
    console.error("Error during chat API call:", error);
    target.updateIntentDisplay("I... don't know what to say.");
    if (target.game) {
      target.game.logEvent(
        target,
        "chat_error",
        `${target.name} failed to respond to ${initiator.name}.`,
        initiator,
        { error: (error as Error).message },
        target.mesh!.position
      );
    }

    if (target.aiController) {
      target.aiController.scheduleNextActionDecision();
    }
  }
}
