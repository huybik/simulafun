/* File: /src/ai/npcAI.ts */
import { Vector3, Object3D } from "three";
import { Entity } from "../entities/entitiy";
import { Character } from "../entities/character";
import { MoveState, getTerrainHeight, InventoryItem } from "../core/utils"; // Added InventoryItem
import { Animal } from "../entities/animals";
import {
  sendToGemini,
  Observation,
  generatePrompt,
  updateObservation,
  handleChatResponse,
} from "./api";
import {
  AI_CONFIG,
  MEMORY_CONFIG,
  REFLEX_CONFIG,
  PROFESSION_DISPOSITION,
  CombatDisposition,
} from "../core/constants";
import { MemoryStream } from "./memoryStream";

export class AIController {
  character: Character;
  aiState: string = "idle";
  previousAiState: string = "idle";
  homePosition: Vector3;
  destination: Vector3 | null = null;
  actionTimer: number = AI_CONFIG.actionTimerBase;
  interactionDistance: number = AI_CONFIG.interactionDistance;
  attackDistance: number = AI_CONFIG.attackDistance;
  followDistance: number = AI_CONFIG.followDistance;
  stoppingDistance: number = AI_CONFIG.stoppingDistance;
  searchRadius: number;
  roamRadius: number;
  target: Entity | Object3D | null = null; // Target can be Entity or resource Object3D
  observation: Observation | null = null;
  persona: string = "";
  currentIntent: string = "";
  targetAction: string | null = null; // "attack", "chat", "trade", "follow"
  message: string | null = null;
  tradeItemsGive: InventoryItem[] = []; // Items NPC wants to give
  tradeItemsReceive: InventoryItem[] = []; // Items NPC wants to receive
  private lastApiCallTime: number = 0;
  private apiCallCooldown: number = AI_CONFIG.apiCallCooldown;
  lastObservation: Observation | null = null;
  // Updated persistentAction to support both targetType and targetId
  persistentAction: {
    type: string;
    targetType?: string;
    targetId?: string;
  } | null = null;
  private chatDecisionTimer: ReturnType<typeof setTimeout> | null = null;
  public lastLoggedAttackTargetId: string | null = null; // Track last logged attack target
  public memoryStream: MemoryStream = new MemoryStream();
  private lastReflexTime: number = 0;
  private isReflexAction: boolean = false; // tracks if current action came from reflex

  get disposition(): CombatDisposition {
    return PROFESSION_DISPOSITION[this.character.profession] || "defensive";
  }

  constructor(character: Character) {
    this.character = character;
    this.homePosition = character.mesh!.position.clone();
    this.searchRadius = character.searchRadius;
    this.roamRadius = character.roamRadius;
    this.persona = character.persona;
  }

  computeAIMoveState(deltaTime: number): MoveState {
    const moveState: MoveState = {
      forward: 0,
      right: 0,
      jump: false,
      sprint: false,
      interact: false,
      attack: false, // Attack intent is now handled by initiating attack via CombatSystem
    };

    if (this.character.isDead) {
      if (this.aiState !== "dead") this.aiState = "dead";
      return moveState; // No actions if dead
    }

    // Update observation for reflex checks
    if (this.character.game) {
      updateObservation(this, this.character.game.entities);
    }

    // Reflex layer: instant rule-based reactions (no API call)
    this.evaluateReflex();

    const currentTime = Date.now();
    this.actionTimer -= deltaTime;
    const timeSinceLastCall = currentTime - this.lastApiCallTime;
    const canCallApi =
      timeSinceLastCall >=
      this.apiCallCooldown + (Math.random() * 10000 - 5000);

    if (this.actionTimer <= 0 && this.chatDecisionTimer === null) {
      this.actionTimer = AI_CONFIG.actionTimerBase + Math.random() * AI_CONFIG.actionTimerVariance;
      if (canCallApi) {
        this.decideNextAction();
        this.lastApiCallTime = currentTime;
      }
    }

    switch (this.aiState) {
      case "deciding":
      case "dead": // Added dead state check here
        break;

      case "idle":
      case "roaming":
        if (this.destination) {
          const direction = this.destination
            .clone()
            .sub(this.character.mesh!.position);
          direction.y = 0;
          const distance = direction.length();
          if (distance > this.stoppingDistance) {
            direction.normalize();
            this.character.lookAt(
              this.character.mesh!.position.clone().add(direction)
            );
            moveState.forward = 1;
          } else {
            this.aiState = "idle";
            this.destination = null;
          }
        } else {
          this.aiState = "idle";
        }
        break;

      case "movingToTarget":
        if (this.target && this.targetAction) {
          const targetPosition =
            this.target instanceof Entity
              ? this.target.mesh!.position
              : this.target.position;
          const isTargetResource = !(this.target instanceof Entity);
          const isTargetEntityDead =
            this.target instanceof Entity && this.target.isDead;
          const isTargetResourceDepleted =
            isTargetResource &&
            (this.target instanceof Object3D
              ? !this.target.visible || !this.target.userData.isInteractable
              : false);

          if (isTargetEntityDead || isTargetResourceDepleted) {
            this.handleTargetLostOrDepleted();
            break;
          }

          const direction = targetPosition
            .clone()
            .sub(this.character.mesh!.position);
          direction.y = 0;
          const distance = direction.length();
          const requiredDistance =
            this.targetAction === "attack"
              ? this.attackDistance
              : this.targetAction === "follow"
                ? this.followDistance // Use followDistance for follow action
                : this.interactionDistance; // Use interactionDistance for chat/trade

          if (distance > requiredDistance) {
            direction.normalize();
            this.character.lookAt(
              this.character.mesh!.position.clone().add(direction)
            );
            moveState.forward = 1;
            // moveState.attack = false; // No longer needed
          } else {
            // Reached target or close enough for action
            this.character.lookAt(targetPosition);
            moveState.forward = 0;

            if (this.targetAction === "attack") {
              // Initiate attack via CombatSystem if cooldown allows
              if (
                this.character.game?.combatSystem &&
                !this.character.isPerformingAction
              ) {
                this.character.game.combatSystem.initiateAttack(
                  this.character,
                  this.target
                );
                // The actual attack execution (damage, etc.) is handled by CombatSystem
                // The animation is triggered within initiateAttack -> character.playAttackAnimation
              }
              // Check if target became invalid *after* initiating attack (e.g., died instantly)
              const targetStillValid =
                this.target instanceof Entity
                  ? !this.target.isDead
                  : this.target.visible && this.target.userData.isInteractable;
              if (!targetStillValid || distance > this.searchRadius) {
                this.handleTargetLostOrDepleted();
              }
            } else if (
              this.targetAction === "chat" &&
              this.message &&
              this.chatDecisionTimer === null &&
              this.target instanceof Character
            ) {
              // Initiate chat
              if (this.target.aiController) {
                this.target.aiController.aiState = "idle";
                this.target.aiController.persistentAction = null;
              }
              this.character.updateIntentDisplay(this.message);
              if (this.character.game) {
                this.character.game.logEvent(
                  this.character,
                  "chat",
                  `${this.character.name} said "${this.message}" to ${this.target.name}.`,
                  this.target,
                  { message: this.message },
                  this.character.mesh!.position
                );
              }
              this.encodeActionMemory("chat", this.target.name, `I said "${this.message}" to ${this.target.name}`);
              handleChatResponse(this.target, this.character, this.message);
              this.resetStateAfterAction();
            } else if (
              this.targetAction === "trade" &&
              this.target instanceof Character &&
              this.character.game?.tradingSystem
            ) {
              // Request trade UI
              this.character.game.tradingSystem.requestTradeUI(
                this.character,
                this.target,
                this.tradeItemsGive,
                this.tradeItemsReceive
              );
              this.encodeActionMemory("trade", this.target.name, `I traded with ${this.target.name}`);
              this.resetStateAfterAction();
            } else if (this.targetAction === "follow") {
              // Transition to the 'following' state once close enough
              this.aiState = "following";
              this.destination = null; // Clear any previous destination
            }
          }
        } else {
          // Target lost or action completed, go idle
          this.resetStateAfterAction();
        }
        break;

      case "following":
        if (
          !this.target ||
          !(this.target instanceof Character) ||
          this.target.isDead
        ) {
          // Target lost or invalid
          this.resetStateAfterAction();
          break;
        }
        const targetPositionFollow = this.target.mesh!.position;
        const directionFollow = targetPositionFollow
          .clone()
          .sub(this.character.mesh!.position);
        directionFollow.y = 0;
        const distanceFollow = directionFollow.length();

        // Check if target moved too far away (leash)
        if (distanceFollow > this.followDistance * 5) {
          console.log(
            `${this.character.name} lost follow target ${this.target.name} (too far).`
          );
          this.resetStateAfterAction();
          break;
        }

        this.character.lookAt(targetPositionFollow); // Always look at target

        if (distanceFollow > this.followDistance) {
          // Move towards target if too far
          moveState.forward = 1;
        } else if (distanceFollow < this.stoppingDistance) {
          // Move slightly back if too close (optional, can cause jittering)
          // moveState.forward = -0.5;
          moveState.forward = 0; // Stop if close enough
        } else {
          // Within follow range, stop moving
          moveState.forward = 0;
        }
        break;

      case "fleeing":
        if (this.destination) {
          const fleeDir = this.destination
            .clone()
            .sub(this.character.mesh!.position);
          fleeDir.y = 0;
          const fleeDist = fleeDir.length();
          if (fleeDist > this.stoppingDistance) {
            fleeDir.normalize();
            this.character.lookAt(
              this.character.mesh!.position.clone().add(fleeDir)
            );
            moveState.forward = 1;
            moveState.sprint = true;
          } else {
            // Reached flee destination, go idle
            this.resetStateAfterAction();
          }
        } else {
          this.resetStateAfterAction();
        }
        break;

      default:
        console.warn(`Unhandled AI state: ${this.aiState}`);
        this.aiState = "idle";
        break;
    }

    this.previousAiState = this.aiState;

    return moveState;
  }

  private resetStateAfterAction(): void {
    this.aiState = "idle";
    this.target = null;
    this.targetAction = null;
    this.message = null;
    this.tradeItemsGive = [];
    this.tradeItemsReceive = [];
    this.persistentAction = null;
    this.isReflexAction = false;
    this.actionTimer = 3 + Math.random() * 4;
    this.lastLoggedAttackTargetId = null;
  }

  private handleTargetLostOrDepleted(): void {
    this.lastLoggedAttackTargetId = null; // Reset logged target when current target is lost/depleted
    if (this.persistentAction?.type === "attack") {
      if (this.persistentAction.targetId) {
        // Handle specific character target by ID
        const targetEntity = this.character.game?.entities.find(
          (e) => e.id === this.persistentAction?.targetId && !e.isDead
        );
        if (
          targetEntity &&
          this.character.mesh!.position.distanceTo(
            targetEntity.mesh!.position
          ) < this.searchRadius
        ) {
          this.target = targetEntity;
          this.aiState = "movingToTarget"; // Explicitly set to ensure state consistency
        } else {
          this.persistentAction = null;
          this.resetStateAfterAction();
        }
      } else if (this.persistentAction.targetType) {
        // Handle target types (resources or animals)
        let nextTarget: Entity | Object3D | null = null;
        const targetType = this.persistentAction.targetType;

        if (["wood", "stone", "herb"].includes(targetType)) {
          nextTarget = this.findNearestResource(targetType);
        } else {
          nextTarget = this.findNearestAnimal(targetType);
        }

        if (nextTarget) {
          this.target = nextTarget;
          this.aiState = "movingToTarget"; // Explicitly set to ensure state consistency
        } else {
          this.persistentAction = null;
          this.resetStateAfterAction();
        }
      } else {
        this.persistentAction = null;
        this.resetStateAfterAction();
      }
    } else {
      // If not a persistent attack, just reset
      this.resetStateAfterAction();
    }
  }

  scheduleNextActionDecision(): void {
    if (this.chatDecisionTimer !== null) {
      clearTimeout(this.chatDecisionTimer);
    }
    this.chatDecisionTimer = setTimeout(() => {
      this.decideNextAction();
      this.chatDecisionTimer = null;
    }, AI_CONFIG.chatDecisionDelay);
  }

  // --- Reflex System ---

  private evaluateReflex(): void {
    const now = Date.now();
    if (now - this.lastReflexTime < REFLEX_CONFIG.reflexCooldown) return;
    if (!this.observation) return;
    // Don't override deliberate API actions unless it's another reflex or idle/roaming
    if (this.aiState === "deciding") return;

    const selfHealth = this.observation.self.health;
    const maxHealth = this.character.maxHealth;
    const healthRatio = selfHealth / maxHealth;
    const disposition = this.disposition;

    // Priority 1: LOW HEALTH — self-preservation overrides everything
    if (
      healthRatio < REFLEX_CONFIG.fleeHealthThreshold &&
      this.aiState !== "fleeing"
    ) {
      const threat = this.findNearestThreat();
      if (threat) {
        this.lastReflexTime = now;
        this.triggerFlee(threat, "Low health, retreating!");
        return;
      }
    }

    // Priority 2: SELF UNDER ATTACK
    if (this.lastObservation && selfHealth < this.lastObservation.self.health) {
      const attacker = this.findAttacker();
      if (attacker) {
        this.lastReflexTime = now;

        if (disposition === "cautious" && healthRatio < REFLEX_CONFIG.cautiousFightThreshold) {
          this.triggerFlee(attacker, "I'm hurt, running away!");
        } else {
          // aggressive, defensive, or cautious with enough health: fight back
          this.triggerAttack(attacker, "Defending myself!");
        }
        return;
      }
    }

    // Priority 3: NEARBY ENTITY UNDER ATTACK (within searchRadius)
    const combatEvent = this.detectNearbyCombat();
    if (combatEvent) {
      this.lastReflexTime = now;

      if (disposition === "aggressive") {
        // Engage the attacker to help the victim
        this.triggerAttack(combatEvent.attacker, `Helping ${combatEvent.victimName}!`);
      } else if (disposition === "defensive" && combatEvent.victimIsCharacter) {
        // Defensive: only help other characters (not animals)
        this.triggerAttack(combatEvent.attacker, `Protecting ${combatEvent.victimName}!`);
      } else if (disposition === "cautious") {
        this.triggerFlee(combatEvent.attacker, "Danger nearby, fleeing!");
      }
      return;
    }

    // Priority 4: HOSTILE ENTITY NEARBY (aggressive animal, no active combat)
    if (disposition === "aggressive" && this.aiState !== "movingToTarget") {
      const hostile = this.findNearestHostile();
      if (hostile) {
        this.lastReflexTime = now;
        this.triggerAttack(hostile, "Engaging hostile creature!");
        return;
      }
    } else if (disposition === "cautious" && this.aiState === "idle") {
      const hostile = this.findNearestHostile();
      if (hostile) {
        const distSq = this.character.mesh!.position.distanceToSquared(hostile.mesh!.position);
        // Only flee if the hostile is getting close (within half search radius)
        if (distSq < (this.searchRadius * 0.5) ** 2) {
          this.lastReflexTime = now;
          this.triggerFlee(hostile, "Hostile creature nearby!");
          return;
        }
      }
    }
  }

  private triggerAttack(target: Entity, intent: string): void {
    // Don't interrupt non-reflex API-driven actions (chat, trade, follow)
    if (!this.isReflexAction && this.targetAction && this.targetAction !== "attack") return;

    this.target = target;
    this.targetAction = "attack";
    this.persistentAction = { type: "attack", targetId: target.id };
    this.aiState = "movingToTarget";
    this.isReflexAction = true;
    this.currentIntent = intent;
    this.character.updateIntentDisplay(intent);

    this.encodeActionMemory("attack", target.name, `I decided to fight ${target.name}: ${intent}`);

    if (this.character.game) {
      this.character.game.logEvent(
        this.character,
        "reflex",
        `${this.character.name}: ${intent}`,
        target,
        { reflex: true },
        this.character.mesh!.position
      );
    }
  }

  private triggerFlee(threat: Entity, intent: string): void {
    const selfPos = this.character.mesh!.position;
    const threatPos = threat.mesh!.position;

    // Flee in opposite direction from threat
    const fleeDirection = selfPos.clone().sub(threatPos);
    fleeDirection.y = 0;
    fleeDirection.normalize();

    const fleeDistance = this.roamRadius;
    this.destination = selfPos
      .clone()
      .add(fleeDirection.multiplyScalar(fleeDistance));

    if (this.character.scene) {
      this.destination.y = getTerrainHeight(
        this.character.scene,
        this.destination.x,
        this.destination.z
      );
    }

    this.target = null;
    this.targetAction = null;
    this.persistentAction = null;
    this.aiState = "fleeing";
    this.isReflexAction = true;
    this.actionTimer = REFLEX_CONFIG.fleeDuration;
    this.currentIntent = intent;
    this.character.updateIntentDisplay(intent);

    this.encodeActionMemory("attack", threat.name, `I fled from ${threat.name}: ${intent}`);

    if (this.character.game) {
      this.character.game.logEvent(
        this.character,
        "reflex",
        `${this.character.name}: ${intent}`,
        threat,
        { reflex: true, flee: true },
        this.character.mesh!.position
      );
    }
  }

  private findAttacker(): Entity | null {
    // Use lastAttacker from entity (set by combat system)
    const attacker = this.character.lastAttacker;
    if (attacker && !attacker.isDead && attacker.mesh) {
      const distSq = this.character.mesh!.position.distanceToSquared(attacker.mesh.position);
      if (distSq < this.searchRadius * this.searchRadius) {
        return attacker;
      }
    }
    return null;
  }

  private findNearestThreat(): Entity | null {
    // Any entity that recently attacked us or any nearby aggressive animal
    return this.findAttacker() || this.findNearestHostile();
  }

  private findNearestHostile(): Entity | null {
    if (!this.character.game) return null;
    let nearest: Entity | null = null;
    let minDistSq = this.searchRadius * this.searchRadius;
    const selfPos = this.character.mesh!.position;

    for (const entity of this.character.game.entities) {
      if (entity === this.character || entity.isDead || !entity.mesh) continue;
      if (entity instanceof Animal && entity.userData.isAggressive) {
        const distSq = selfPos.distanceToSquared(entity.mesh.position);
        if (distSq < minDistSq) {
          minDistSq = distSq;
          nearest = entity;
        }
      }
    }
    return nearest;
  }

  private detectNearbyCombat(): {
    attacker: Entity;
    victimName: string;
    victimIsCharacter: boolean;
  } | null {
    if (!this.observation || !this.lastObservation) return null;

    // Check if any nearby character lost health (someone is being attacked)
    for (const curr of this.observation.nearbyCharacters) {
      const prev = this.lastObservation.nearbyCharacters.find((c) => c.id === curr.id);
      if (prev && curr.health < prev.health && !curr.isDead) {
        // This character is under attack — find who's attacking them
        const victim = this.character.game?.entities.find(
          (e) => e.id === curr.id && e instanceof Character
        ) as Character | undefined;
        if (victim?.lastAttacker && !victim.lastAttacker.isDead) {
          // Don't intervene if we ARE the attacker
          if (victim.lastAttacker === this.character) return null;
          return {
            attacker: victim.lastAttacker,
            victimName: curr.id,
            victimIsCharacter: true,
          };
        }
      }
    }

    // Check nearby animals losing health (could indicate player fighting)
    for (const curr of this.observation.nearbyAnimals) {
      const prev = this.lastObservation.nearbyAnimals.find((a) => a.id === curr.id);
      if (prev && curr.health < prev.health && !curr.isDead && curr.isAggressive) {
        // An aggressive animal is in combat nearby — the animal is the threat
        const animal = this.character.game?.entities.find(
          (e) => e.id === curr.id && e instanceof Animal
        );
        if (animal && !animal.isDead) {
          return {
            attacker: animal,
            victimName: "someone",
            victimIsCharacter: false,
          };
        }
      }
    }

    return null;
  }

  async decideNextAction(): Promise<void> {
    // Prevent API call if dead
    if (this.character.isDead) {
      if (this.aiState !== "dead") {
        this.aiState = "dead"; // Ensure state consistency
      }
      return;
    }

    // Observation already updated by computeAIMoveState before reflex check

    // Encode notable changes as memories
    this.encodeObservationMemories();

    // Don't decide if already following or deciding
    if (this.aiState === "following" || this.aiState === "deciding") return;

    this.aiState = "deciding";

    const prompt = generatePrompt(this);
    try {
      console.log(
        `time since last call in seconds: ${(Date.now() - this.lastApiCallTime) / 1000}`
      ); // dont remove this
      console.log(`Prompt for ${this.character.name}:\n${prompt}\n\n`); // dont remove this
      const response = await sendToGemini(prompt);
      this.lastApiCallTime = Date.now();
      if (response) {
        const actionData = JSON.parse(response);
        console.log(
          `Response from API for ${this.character.name}:\n${response}\n\n`
        ); // dont remove this
        this.setActionFromAPI(actionData);
      } else {
        this.fallbackToDefaultBehavior();
      }

      // Trigger reflection if threshold met (piggyback on decision cycle)
      if (this.memoryStream.shouldReflect()) {
        this.memoryStream.reflect(this.character.name);
      }
    } catch (error) {
      console.error(`Error querying API for ${this.character.name}:`, error);
      // Ensure fallback doesn't run if dead (e.g., died during API call)
      if (!this.character.isDead) {
        this.fallbackToDefaultBehavior();
      } else {
        this.aiState = "dead"; // Ensure state remains dead on error
      }
    }
  }

  private encodeObservationMemories(): void {
    if (!this.observation || !this.lastObservation) return;

    const self = this.observation.self;
    const lastSelf = this.lastObservation.self;

    // Health lost — encode as combat memory
    if (self.health < lastSelf.health) {
      const damage = lastSelf.health - self.health;
      const attacker = this.character.lastAttacker;
      const attackerName = attacker?.name || "something";
      this.memoryStream.add(
        `I was hit by ${attackerName} and lost ${damage.toFixed(0)} health (now ${self.health.toFixed(0)})`,
        "observation",
        MEMORY_CONFIG.importanceThresholds.combat,
        attacker ? [attackerName] : []
      );

      // Near-death memory
      if (self.health < self.health * 0.3 && lastSelf.health >= self.health * 0.3) {
        this.memoryStream.add(
          `I nearly died from ${attackerName}'s attack`,
          "observation",
          MEMORY_CONFIG.importanceThresholds.nearDeath,
          attacker ? [attackerName] : []
        );
      }
    }

    // Detect new characters appearing nearby
    const lastIds = new Set(this.lastObservation.nearbyCharacters.map((c) => c.id));
    for (const char of this.observation.nearbyCharacters) {
      if (!lastIds.has(char.id) && !char.isDead) {
        this.memoryStream.add(
          `${char.id} appeared nearby`,
          "observation",
          MEMORY_CONFIG.importanceThresholds.environmental,
          [char.id]
        );
      }
    }

    // Detect nearby character deaths
    for (const char of this.observation.nearbyCharacters) {
      const prev = this.lastObservation.nearbyCharacters.find((c) => c.id === char.id);
      if (prev && !prev.isDead && char.isDead) {
        this.memoryStream.add(
          `${char.id} died nearby`,
          "observation",
          MEMORY_CONFIG.importanceThresholds.combat,
          [char.id]
        );
      }
    }
  }

  encodeActionMemory(action: string, targetName: string, details: string): void {
    const typeMap: Record<string, { type: "observation" | "episode"; importance: number }> = {
      attack: { type: "episode", importance: MEMORY_CONFIG.importanceThresholds.combat },
      chat: { type: "episode", importance: MEMORY_CONFIG.importanceThresholds.conversation },
      trade: { type: "episode", importance: MEMORY_CONFIG.importanceThresholds.trade },
      follow: { type: "episode", importance: MEMORY_CONFIG.importanceThresholds.conversation },
      death: { type: "observation", importance: MEMORY_CONFIG.importanceThresholds.death },
    };
    const config = typeMap[action] || { type: "observation" as const, importance: 0.3 };
    this.memoryStream.add(details, config.type, config.importance, [targetName]);
  }

  fallbackToDefaultBehavior(): void {
    console.warn(
      `Falling back to default behavior for ${this.character.name}.`
    );
    this.aiState = "roaming";
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * this.roamRadius;
    this.destination = this.homePosition
      .clone()
      .add(
        new Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance)
      );
    if (this.character.scene) {
      this.destination.y = getTerrainHeight(
        this.character.scene,
        this.destination.x,
        this.destination.z
      );
    }
    this.target = null;
    this.targetAction = null;
    this.message = null;
    this.tradeItemsGive = [];
    this.tradeItemsReceive = [];
    this.persistentAction = null;
    this.isReflexAction = false;
    this.currentIntent = "Exploring";
    this.character.updateIntentDisplay(this.currentIntent);
    this.lastLoggedAttackTargetId = null;
  }

  setActionFromAPI(actionData: {
    action: string;
    target_id?: string;
    message?: string;
    give_items?: InventoryItem[];
    receive_items?: InventoryItem[];
    intent: string;
  }): void {
    // If character died while API call was in progress, ignore the response
    if (this.character.isDead) {
      this.aiState = "dead";
      return;
    }

    const { action, target_id, message, give_items, receive_items, intent } =
      actionData;
    this.currentIntent = intent || "Thinking...";
    this.character.updateIntentDisplay(`${this.currentIntent}`);
    this.destination = null;
    this.target = null;
    this.targetAction = null;
    this.message = null;
    this.tradeItemsGive = [];
    this.tradeItemsReceive = [];
    this.persistentAction = null; // Reset persistent action by default
    this.lastLoggedAttackTargetId = null; // Reset logged target when setting new action
    this.isReflexAction = false; // API action overrides reflex

    this.actionTimer = 5 + Math.random() * 5;

    if (action === "attack" && target_id) {
      let foundTarget: Entity | Object3D | null = null;

      foundTarget =
        this.character.game?.entities.find((e) => e.id === target_id) ?? null;

      if (!foundTarget) {
        foundTarget =
          this.character.scene?.children.find(
            (child) =>
              child.userData.id === target_id &&
              child.userData.isInteractable &&
              child.visible
          ) ?? null;
      }

      if (foundTarget) {
        if (foundTarget instanceof Character) {
          // Set persistent action for specific character ID
          this.persistentAction = { type: "attack", targetId: foundTarget.id };
          this.target = foundTarget;
          this.targetAction = "attack";
          this.aiState = "movingToTarget";
        } else {
          // Handle resources and animals with targetType
          let targetType: string | null = null;
          if (foundTarget instanceof Animal) {
            targetType = foundTarget.animalType;
          } else if (
            foundTarget instanceof Object3D &&
            foundTarget.userData.resource
          ) {
            targetType = foundTarget.userData.resource;
          }

          if (targetType) {
            this.persistentAction = { type: "attack", targetType };
            const nearestTarget = ["wood", "stone", "herb"].includes(targetType)
              ? this.findNearestResource(targetType)
              : this.findNearestAnimal(targetType);
            if (nearestTarget) {
              this.target = nearestTarget;
              this.targetAction = "attack";
              this.aiState = "movingToTarget";
            } else {
              this.handleTargetLostOrDepleted();
            }
          } else {
            // If it's not a known resource/animal type but still a target
            this.target = foundTarget;
            this.targetAction = "attack";
            this.aiState = "movingToTarget";
            // No persistent action set if type is unknown
          }
        }
      } else {
        this.handleTargetLostOrDepleted();
      }
    } else if (action === "chat" && target_id) {
      const targetEntity = this.character.game?.entities.find(
        (e) => e.id === target_id && e instanceof Character && !e.isDead
      );
      if (targetEntity) {
        this.target = targetEntity;
        this.targetAction = "chat";
        this.message = message || "...";
        this.aiState = "movingToTarget";
      } else {
        this.handleTargetLostOrDepleted();
      }
    } else if (action === "trade" && target_id && give_items && receive_items) {
      const targetEntity = this.character.game?.entities.find(
        (e) => e.id === target_id && e instanceof Character && !e.isDead
      );
      if (targetEntity) {
        // Ensure target is the active player for trade requests
        if (targetEntity === this.character.game?.activeCharacter) {
          this.target = targetEntity;
          this.targetAction = "trade";
          this.tradeItemsGive = give_items;
          this.tradeItemsReceive = receive_items;
          this.aiState = "movingToTarget"; // Move towards player to initiate trade UI
        } else {
          console.warn(
            `AI ${this.character.name} tried to trade with non-player ${targetEntity.name}. Falling back.`
          );
          this.fallbackToDefaultBehavior();
        }
      } else {
        this.handleTargetLostOrDepleted();
      }
    } else if (action === "follow" && target_id) {
      const targetEntity = this.character.game?.entities.find(
        (e) => e.id === target_id && e instanceof Character && !e.isDead
      );
      if (targetEntity) {
        this.target = targetEntity;
        this.targetAction = "follow"; // Set the action type
        this.aiState = "movingToTarget"; // Start by moving towards the target
        // Following is inherently persistent until target lost or new action decided
        // No need for separate persistentAction object for follow
      } else {
        console.warn(
          `${this.character.name} tried to follow invalid target ${target_id}. Falling back.`
        );
        this.fallbackToDefaultBehavior();
      }
    } else {
      // Default to idle or roaming if action is invalid or "idle"
      this.fallbackToDefaultBehavior(); // Use fallback which sets to roaming/idle
    }
  }

  findNearestResource(resourceType: string): Object3D | null {
    if (!this.character.scene) return null;
    let nearest: Object3D | null = null;
    let minDistanceSq = Infinity;
    const selfPosition = this.character.mesh!.position;
    const searchRadiusSq = this.searchRadius * this.searchRadius;
    this.character.scene.traverse((child) => {
      if (
        child.userData.isInteractable &&
        child.userData.resource === resourceType &&
        child.visible &&
        child.userData.health > 0
      ) {
        const distanceSq = selfPosition.distanceToSquared(child.position);
        if (distanceSq < searchRadiusSq && distanceSq < minDistanceSq) {
          minDistanceSq = distanceSq;
          nearest = child;
        }
      }
    });
    return nearest;
  }

  findNearestAnimal(animalType: string): Animal | null {
    if (!this.character.game) return null;
    let nearest: Animal | null = null;
    let minDistanceSq = Infinity;
    const selfPosition = this.character.mesh!.position;
    const searchRadiusSq = this.searchRadius * this.searchRadius;
    for (const entity of this.character.game.entities) {
      if (
        entity instanceof Animal &&
        entity.animalType === animalType &&
        !entity.isDead
      ) {
        const distanceSq = selfPosition.distanceToSquared(
          entity.mesh!.position
        );
        if (distanceSq < searchRadiusSq && distanceSq < minDistanceSq) {
          minDistanceSq = distanceSq;
          nearest = entity;
        }
      }
    }
    return nearest;
  }
}
