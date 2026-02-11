/* File: src/core/gameLoop.ts */
import { Game } from "../main";
import { Character } from "../entities/character";
import { Animal } from "../entities/animals";
import { AIController } from "../ai/npcAI";
import { AnimalAIController } from "../ai/animalAI";
import { updateParticleEffects } from "../systems/particles";
import { Group } from "three";
import { Profiler } from "./profiler"; // Import Profiler

/**
 * Executes a single step of the game loop.
 * @param game The main game instance.
 * @param profiler The profiler instance.
 */
export function runGameLoopStep(game: Game, profiler: Profiler): void {
  profiler.start("runGameLoopStep");

  if (
    !game.clock ||
    !game.renderer ||
    !game.scene ||
    !game.camera ||
    !game.activeCharacter ||
    !game.isGameStarted
  ) {
    profiler.end("runGameLoopStep");
    return;
  }

  profiler.start("GetDelta");
  const deltaTime = Math.min(game.clock.getDelta(), 0.05);
  const elapsedTime = game.clock.elapsedTime;
  profiler.end("GetDelta");

  profiler.start("Controls.update");
  game.controls!.update(deltaTime);
  profiler.end("Controls.update");

  profiler.start("MobileControls.update");
  game.mobileControls?.update(deltaTime);
  profiler.end("MobileControls.update");

  if (!game.isPaused) {
    profiler.start("GameLogic");

    const currentTime = game.clock.elapsedTime;
    const timeSinceLastAiUpdate = currentTime - game.lastAiUpdateTime;
    const shouldUpdateAiLogic = timeSinceLastAiUpdate >= game.aiUpdateInterval;

    if (shouldUpdateAiLogic) {
      game.lastAiUpdateTime = currentTime;
    }

    profiler.start("PlayerAttackInput");
    if (game.controls?.moveState.attack || game.mobileControls?.attackHeld) {
      game.handlePlayerAttackInput();
    }
    profiler.end("PlayerAttackInput");

    profiler.start("Player.update");
    game.activeCharacter.update(deltaTime, {
      moveState: game.controls!.moveState,
      collidables: game.collidableObjects,
    });
    profiler.end("Player.update");

    profiler.start("Physics.update");
    game.physics!.update(deltaTime);
    profiler.end("Physics.update");

    profiler.start("Entities.update");
    game.entities.forEach((entity) => {
      if (entity === game.activeCharacter) return;

      if (
        entity instanceof Character &&
        entity.aiController instanceof AIController
      ) {
        profiler.start(`NPC_${entity.id}.update`);
        if (shouldUpdateAiLogic) {
          profiler.start(`NPC_${entity.id}.computeAIMoveState`);
          entity.moveState = entity.aiController.computeAIMoveState(
            timeSinceLastAiUpdate
          );
          profiler.end(`NPC_${entity.id}.computeAIMoveState`);
        }
        entity.update(deltaTime, {
          moveState: entity.moveState,
          collidables: game.collidableObjects,
        });
        profiler.end(`NPC_${entity.id}.update`);
      } else if (
        entity instanceof Animal &&
        entity.aiController instanceof AnimalAIController
      ) {
        profiler.start(`Animal_${entity.id}.update`);
        if (shouldUpdateAiLogic) {
          profiler.start(`Animal_${entity.id}.updateLogic`);
          entity.aiController.updateLogic(timeSinceLastAiUpdate);
          profiler.end(`Animal_${entity.id}.updateLogic`);
        }
        entity.update(deltaTime, { collidables: game.collidableObjects });
        profiler.end(`Animal_${entity.id}.update`);
      } else if (
        entity instanceof Group &&
        entity.userData?.mixer &&
        entity.userData?.isFalling
      ) {
        profiler.start(`FallingTree_${entity.uuid}.update`);
        entity.userData.mixer.update(deltaTime);
        if (
          !entity.userData.fallAction.isRunning() &&
          entity.userData.isFalling
        ) {
          entity.userData.isFalling = false;
          entity.visible = false;
          entity.userData.isCollidable = false;
          entity.userData.isInteractable = false;
          const respawnTime = entity.userData.respawnTime || 20000;
          const maxHealth = entity.userData.maxHealth;
          setTimeout(() => {
            if (entity && entity.userData) {
              entity.visible = true;
              entity.userData.isCollidable = true;
              entity.userData.isInteractable = true;
              entity.userData.health = maxHealth;
              entity.rotation.set(0, 0, 0);
              entity.quaternion.set(0, 0, 0, 1);
            }
          }, respawnTime);
        }
        profiler.end(`FallingTree_${entity.uuid}.update`);
      } else if (
        entity.update &&
        !(entity instanceof Character) &&
        !(entity instanceof Animal) &&
        !(entity instanceof Group && entity.userData?.mixer)
      ) {
        profiler.start(`OtherEntity_${entity.id || entity.uuid}.update`);
        entity.update(deltaTime);
        profiler.end(`OtherEntity_${entity.id || entity.uuid}.update`);
      }
    });
    profiler.end("Entities.update");

    profiler.start("CombatSystem.update");
    game.combatSystem?.update(deltaTime);
    profiler.end("CombatSystem.update");

    profiler.start("InteractionSystem.update");
    game.interactionSystem!.update(deltaTime);
    profiler.end("InteractionSystem.update");

    profiler.start("Camera.update");
    game.thirdPersonCamera!.update(deltaTime, game.collidableObjects);
    profiler.end("Camera.update");

    // Dynamic shadow camera follows player for high-quality nearby shadows
    profiler.start("ShadowCamera.update");
    const dirLight = game.scene?.userData?.directionalLight;
    if (dirLight && game.activeCharacter?.mesh) {
      const playerPos = game.activeCharacter.mesh.position;
      dirLight.target.position.set(playerPos.x, playerPos.y, playerPos.z);
      dirLight.position.set(
        playerPos.x + 80,
        playerPos.y + 160,
        playerPos.z + 60
      );
      dirLight.target.updateMatrixWorld();
    }
    profiler.end("ShadowCamera.update");

    profiler.start("PortalManager.animate");
    game.portalManager.animatePortals();
    profiler.end("PortalManager.animate");

    profiler.start("PortalManager.checkCollisions");
    game.portalManager.checkPortalCollisions();
    profiler.end("PortalManager.checkCollisions");

    profiler.start("Particles.update");
    updateParticleEffects(game, elapsedTime);
    profiler.end("Particles.update");

    profiler.start("DroppedItems.update");
    game.droppedItemManager?.update(deltaTime);
    profiler.end("DroppedItems.update");

    profiler.start("CheckRespawn");
    game.checkRespawn();
    profiler.end("CheckRespawn");

    profiler.start("QuestCheck");
    if (currentTime - game.lastQuestCheckTime > game.questCheckInterval) {
      game.questManager.checkAllQuestsCompletion();
      game.lastQuestCheckTime = currentTime;
    }
    profiler.end("QuestCheck");

    profiler.start("PlayerRespawnCheck");
    if (game.activeCharacter.isDead) game.respawnPlayer();
    profiler.end("PlayerRespawnCheck");

    profiler.end("GameLogic");
  } else {
    // Minimal updates when paused
    profiler.start("PausedUpdates");
    // Potentially update UI elements that need updates even when paused
    profiler.end("PausedUpdates");
  }

  profiler.start("HUD.update");
  game.hud!.update();
  profiler.end("HUD.update");

  profiler.start("Minimap.update");
  game.minimap!.update();
  profiler.end("Minimap.update");

  profiler.start("Notifications.update");
  game.notificationManager?.update(deltaTime);
  profiler.end("Notifications.update");

  profiler.start("Renderer.render");
  game.renderer.render(game.scene, game.camera);
  profiler.end("Renderer.render");

  profiler.end("runGameLoopStep");
}
