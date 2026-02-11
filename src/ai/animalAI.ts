/* File: /src/ai/animalAI.ts */
import { Vector3 } from "three";
import { Animal } from "../entities/animals";
import { MoveState, getTerrainHeight } from "../core/utils";
import { Character } from "../entities/character";
import { Entity } from "../entities/entitiy"; // Import Entity
import { ANIMAL_AI_CONFIG } from "../core/constants";

export class AnimalAIController {
  animal: Animal;
  aiState: string = "idle";
  previousAiState: string = "idle";
  homePosition: Vector3;
  destination: Vector3 | null = null;
  actionTimer: number = ANIMAL_AI_CONFIG.actionTimer;
  attackCooldown: number = ANIMAL_AI_CONFIG.attackCooldown;
  lastAttackTime: number = 0;
  target: Character | null = null; // Target for attacking
  attackRange: number = ANIMAL_AI_CONFIG.attackRange;
  detectionRange: number = ANIMAL_AI_CONFIG.detectionRange;
  detectionRangeSq: number; // Store squared value
  roamRadius: number = ANIMAL_AI_CONFIG.roamRadius;
  persistentAction: string | null = null;
  // Removed persona, targetResource, targetAction, message, persistentAction as they are not used here

  // Throttling for expensive operations like finding targets
  private findTargetTimer: number = 0;
  private findTargetInterval: number = 0.5 + Math.random() * 0.5; // Check for targets every 0.5-1s
  public lastLoggedAttackTargetId: string | null = null; // Track last logged attack target

  constructor(animal: Animal) {
    this.animal = animal;
    this.homePosition = animal.mesh!.position.clone();
    this.detectionRangeSq = this.detectionRange * this.detectionRange; // Pre-calculate squared range
  }

  // New method to handle throttled logic updates
  updateLogic(deltaTime: number): void {
    if (this.animal.isDead) {
      this.aiState = "dead";
      return; // No decisions if dead
    }

    // Throttle target finding
    this.findTargetTimer -= deltaTime;
    if (this.findTargetTimer <= 0) {
      this.findTarget();
      this.findTargetTimer = this.findTargetInterval;
    }

    // Update state timers
    switch (this.aiState) {
      case "idle":
        this.actionTimer -= deltaTime;
        if (this.target && this.animal.userData.isAggressive) {
          this.setState("attacking");
        } else if (this.actionTimer <= 0) {
          this.setState("roaming");
        }
        break;
      case "roaming":
        if (this.target && this.animal.userData.isAggressive) {
          this.setState("attacking");
          this.destination = null; // Stop roaming
        } else if (!this.destination) {
          // If somehow lost destination while roaming, go idle
          this.setState("idle");
        } else {
          // Check if reached destination (moved to computeAIMovement)
        }
        break;
      case "attacking":
        if (!this.target || this.target.isDead) {
          this.setState("idle");
          this.target = null;
          this.actionTimer = 3 + Math.random() * 3; // Cooldown after losing target
          break;
        }
        const distanceToTargetSq = this.animal.mesh!.position.distanceToSquared(
          this.target.mesh!.position
        );
        // Check if target moved too far away
        if (distanceToTargetSq > this.detectionRangeSq * 2.25) {
          // Use 1.5 * range squared
          this.setState("idle"); // Lose target if too far
          this.target = null;
          this.actionTimer = 5 + Math.random() * 5;
        }
        break;
      case "dead":
        // No logic updates needed
        break;
    }

    // Log state changes (optional, for debugging)
    if (this.aiState !== this.previousAiState) {
      this.previousAiState = this.aiState;
    }
  }

  // Renamed from computeAIMoveState to focus only on movement calculation
  computeAIMovement(): MoveState {
    const moveState: MoveState = {
      forward: 0,
      right: 0, // Animals typically don't strafe
      jump: false,
      sprint: false, // Animals might always "run" or have different speeds
      interact: false,
      attack: false, // Attack intent is now handled by initiating attack via CombatSystem
    };

    if (this.aiState === "dead") {
      return moveState; // No actions if dead
    }

    switch (this.aiState) {
      case "idle":
        // No movement
        break;

      case "roaming":
        if (this.destination) {
          const direction = this.destination
            .clone()
            .sub(this.animal.mesh!.position);
          direction.y = 0; // Ignore vertical distance for movement decision
          const distance = direction.length();

          if (distance > 1.0) {
            // Threshold to stop near destination
            direction.normalize();
            this.animal.lookAt(
              this.animal.mesh!.position.clone().add(direction)
            );
            moveState.forward = 1; // Move forward
            moveState.sprint = true; // Example: Animals usually run when moving
          } else {
            // Reached destination
            this.setState("idle"); // Transition state here
            this.destination = null;
          }
        }
        break;

      case "attacking":
        if (this.target && this.target.mesh) {
          const targetPosition = this.target.mesh!.position;
          const directionToTarget = targetPosition
            .clone()
            .sub(this.animal.mesh!.position);
          directionToTarget.y = 0;
          const distanceToTarget = directionToTarget.length();

          this.animal.lookAt(targetPosition); // Always face the target

          if (distanceToTarget > this.attackRange) {
            // Move towards target
            moveState.forward = 1;
            moveState.sprint = true; // Run towards target
          } else {
            // Within attack range
            moveState.forward = 0; // Stop moving
            // Initiate attack via CombatSystem if cooldown allows
            if (
              this.animal.game?.combatSystem &&
              !this.animal.isPerformingAction
            ) {
              this.animal.game.combatSystem.initiateAttack(
                this.animal,
                this.target
              );
              // The actual attack execution (damage, etc.) is handled by CombatSystem
              // The animation is triggered within initiateAttack -> animal.playAttackAnimation
            }
          }
        }
        break;

      case "dead":
        // No movement or actions
        break;
    }

    return moveState;
  }

  // Helper to set state and reset timers/destinations appropriately
  setState(newState: string): void {
    if (this.aiState === newState) return;

    this.previousAiState = this.aiState;
    this.aiState = newState;

    // Reset things based on entering the new state
    switch (newState) {
      case "idle":
        this.actionTimer = 2 + Math.random() * 4; // Idle for a bit
        this.destination = null;
        this.target = null; // Clear target when going idle
        this.lastLoggedAttackTargetId = null; // Reset logged target
        break;
      case "roaming":
        this.actionTimer = 5 + Math.random() * 10; // Reset timer for next roam decision *after* this roam finishes
        this.setNewRoamDestination();
        this.lastLoggedAttackTargetId = null; // Reset logged target
        break;
      case "attacking":
        this.destination = null; // Stop roaming if switching to attack
        // Target should already be set before switching to this state
        // Don't reset lastLoggedAttackTargetId here, only when leaving attack state
        break;
      case "dead":
        this.destination = null;
        this.target = null;
        this.lastLoggedAttackTargetId = null; // Reset logged target
        break;
    }
  }

  findTarget(): void {
    if (!this.animal.game || !this.animal.mesh) return;

    let closestTarget: Character | null = null;
    // Use squared distance for efficiency
    let minDistanceSq = this.detectionRangeSq;
    const currentPosition = this.animal.mesh.position;

    // OPTIMIZATION: Iterate only through potential targets (Characters)
    for (const entity of this.animal.game.entities) {
      // Early exit if not a character or dead or no mesh
      if (!(entity instanceof Character) || entity.isDead || !entity.mesh) {
        continue;
      }

      // OPTIMIZATION: Check distance squared first
      const distanceSq = currentPosition.distanceToSquared(
        entity.mesh.position
      );
      if (distanceSq < minDistanceSq) {
        // Could add Line-of-Sight check here if needed
        // const hasLOS = checkLineOfSight(this.animal.mesh.position, entity.mesh.position, this.animal.game.collidableObjects);
        // if (hasLOS) {
        minDistanceSq = distanceSq;
        closestTarget = entity;
        // }
      }
    }
    // Only update target if a new one is found or the current one is lost/invalid
    if (this.target !== closestTarget) {
      this.target = closestTarget;
      // If a target is acquired while idle/roaming, potentially switch state immediately
      if (
        this.target &&
        this.animal.userData.isAggressive &&
        (this.aiState === "idle" || this.aiState === "roaming")
      ) {
        this.setState("attacking");
      }
    }
  }

  setNewRoamDestination(): void {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * this.roamRadius;
    const newDest = this.homePosition
      .clone()
      .add(
        new Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance)
      );

    // Clamp destination within world bounds (approximate)
    const worldHalfSize = this.animal.game?.worldSize
      ? this.animal.game.worldSize / 2 - 2
      : 48; // Fallback
    newDest.x = Math.max(-worldHalfSize, Math.min(worldHalfSize, newDest.x));
    newDest.z = Math.max(-worldHalfSize, Math.min(worldHalfSize, newDest.z));

    // Set Y based on terrain height
    if (this.animal.scene) {
      newDest.y = getTerrainHeight(this.animal.scene, newDest.x, newDest.z);
    }
    this.destination = newDest; // Set the destination
  }
}
