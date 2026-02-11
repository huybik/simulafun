/* File: src/main.ts */
import * as THREE from "three";
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Clock,
  Vector3,
  Color,
  Fog,
  PCFSoftShadowMap,
  Object3D,
  Group,
  AnimationClip,
  Box3,
  MathUtils,
} from "three";
import WebGL from "three/examples/jsm/capabilities/WebGL.js";
import { Entity } from "./entities/entitiy";
import { Character } from "./entities/character";
import { Animal } from "./entities/animals";
import { InteractionSystem } from "./systems/interaction";
import { Physics } from "./systems/physics";
import { ThirdPersonCamera } from "./systems/camera";
import { Controls } from "./controls/controls";
import { MobileControls } from "./controls/mobileControls";
import { HUD } from "./ui/hud";
import { InventoryDisplay } from "./ui/inventory";
import { JournalDisplay } from "./ui/journal";
import { Minimap } from "./ui/minimap";
import { NotificationManager } from "./ui/notificationManager";
import { VoiceManager } from "./systems/voiceManager.ts";
import {
  Inventory,
  getTerrainHeight,
  Quest,
  InventoryItem,
  EventEntry,
} from "./core/utils.ts";
import { WORLD_SIZE, TERRAIN_SEGMENTS, GAME_LOOP } from "./core/constants";
import { loadModels } from "./core/assetLoader";
import { createTerrain } from "./core/terrain";
import { setupLighting } from "./core/lighting";
import { populateEnvironment } from "./core/environment";
import { createWorldBoundary } from "./models/walls.ts";
import {
  spawnParticleEffect,
  updateParticleEffects,
} from "./systems/particles";
import { AIController } from "./ai/npcAI.ts";
import { AnimalAIController } from "./ai/animalAI.ts";
import { LandingPage } from "./ui/landingPage.ts";
import { QuestManager } from "./core/questManager.ts";
import { PortalManager } from "./objects/portalManagement";
import { TradingSystem } from "./systems/tradingSystem.ts";
import { CombatSystem } from "./systems/combatSystem.ts";
import {
  getItemDefinition,
  isWeapon,
  Profession,
  ProfessionStartingWeapon,
} from "./core/items";
import { DroppedItemManager } from "./systems/droppedItemManager.ts";
import { UIManager } from "./ui/uiManager.ts"; // Import UIManager
import { initializeGame } from "./core/initialization.ts";
import { runGameLoopStep } from "./core/gameLoop.ts";
import { Profiler } from "./core/profiler.ts"; // Import Profiler

export class Game {
  scene: Scene | null = null;
  renderer: WebGLRenderer | null = null;
  camera: PerspectiveCamera | null = null;
  clock: Clock | null = null;
  activeCharacter: Character | null = null;
  thirdPersonCamera: ThirdPersonCamera | null = null;
  controls: Controls | null = null;
  mobileControls: MobileControls | null = null;
  physics: Physics | null = null;
  combatSystem: CombatSystem | null = null;
  inventory: Inventory | null = null;
  interactionSystem: InteractionSystem | null = null;
  tradingSystem: TradingSystem | null = null;
  droppedItemManager: DroppedItemManager | null = null;
  hud: HUD | null = null;
  minimap: Minimap | null = null;
  inventoryDisplay: InventoryDisplay | null = null;
  journalDisplay: JournalDisplay | null = null;
  notificationManager: NotificationManager | null = null;
  uiManager: UIManager | null = null; // Add UIManager
  entities: Array<any> = [];
  collidableObjects: Object3D[] = [];
  interactableObjects: Array<any> = [];
  isPaused: boolean = false;
  intentContainer: HTMLElement | null = null;
  particleEffects: Group[] = [];
  audioElement: HTMLAudioElement | null = null;
  startPortalRefUrl: string | null = null;
  startPortalOriginalParams: URLSearchParams | null = null;
  hasEnteredFromPortal: boolean = false;
  questManager: QuestManager;
  boundHandleVisibilityChange: () => void;
  wasPausedBeforeVisibilityChange: boolean = false;
  wasMusicPlayingBeforePause: boolean = false; // Flag for music state
  worldSize: number = WORLD_SIZE;
  language: string = "en";
  playerProfession: Profession = Profession.None;
  isGameStarted: boolean = false;
  private landingPage: LandingPage | null = null;
  public portalManager: PortalManager;
  public wolfKillCount: number = 0;
  public characterSwitchingEnabled: boolean = false;

  public lastAiUpdateTime: number = 0; // Made public for gameLoop
  public aiUpdateInterval: number = GAME_LOOP.aiUpdateInterval; // Made public for gameLoop
  public lastQuestCheckTime: number = 0; // Made public for gameLoop
  public questCheckInterval: number = GAME_LOOP.questCheckInterval; // Made public for gameLoop
  private lastUpdateTime: number = 0;
  private targetFrameTime: number = 1000 / GAME_LOOP.targetFPS;

  public models!: Record<string, { scene: Group; animations: AnimationClip[] }>;
  private modelsPromise: Promise<
    Record<string, { scene: Group; animations: AnimationClip[] }>
  > | null = null;
  private isCoreGameInitialized: boolean = false;
  public profiler: Profiler; // Add profiler instance
  public voiceManager: VoiceManager | null = null;

  constructor() {
    this.questManager = new QuestManager(this);
    this.portalManager = new PortalManager(this);
    this.boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.profiler = new Profiler(); // Instantiate the profiler
  }

  async init(): Promise<void> {
    // --- Phase 1: Immediate UI Setup ---
    this.clock = new Clock();
    this.renderer = initializeGame.initRenderer(); // Use initializer
    this.scene = initializeGame.initScene(this); // Use initializer
    this.camera = initializeGame.initCamera(); // Use initializer
    this.inventory = initializeGame.initInventory(); // Use initializer
    this.audioElement = initializeGame.initAudio(); // Use initializer

    // --- Phase 2: Background Asset Loading ---
    const modelPaths = {
      player: "assets/player.glb",
      tavernMan: "assets/tavernman.glb",
      oldMan: "assets/oldman.glb",
      woman: "assets/woman.glb",
      // Add weapon models here
      "sword.glb": "assets/items/weapons/sword.glb",
      "axe.glb": "assets/items/weapons/axe.glb",
      "pickaxe.glb": "assets/items/weapons/pickaxe.glb",
    };
    // Start loading models but don't await here
    this.modelsPromise = loadModels(modelPaths);
    this.modelsPromise
      .then((models) => (this.models = models)) // Store models when ready
      .catch((err) => console.error("Failed to load models:", err)); // Handle loading errors

    // --- Phase 3: Landing Page Setup ---
    this.landingPage = new LandingPage(this);
    const savedName = localStorage.getItem("playerName");
    const savedLang = localStorage.getItem("selectedLanguage");
    const savedProfession = localStorage.getItem(
      "selectedProfession"
    ) as Profession | null;
    this.language = savedLang || "en";
    this.playerProfession = savedProfession || Profession.Hunter; // Set default early
    this.landingPage.setup(savedName, savedLang, savedProfession); // Show landing page UI

    // --- Phase 4: Event Listeners ---
    document.addEventListener(
      "pointerlockchange",
      this.handlePointerLockChange.bind(this)
    );
    document.addEventListener(
      "visibilitychange",
      this.boundHandleVisibilityChange
    );
    window.addEventListener("resize", this.onWindowResize.bind(this), false); // Add resize listener

    // Don't start animation loop here
    console.log(
      "Game initialized. Waiting for user to start via landing page."
    );
  }

  // Called by LandingPage when start button is clicked
  async startGameCore(): Promise<void> {
    if (this.isCoreGameInitialized) return; // Prevent double initialization

    console.log("Starting core game initialization...");

    // --- Phase 5: Wait for Assets & Initialize Game World ---
    if (!this.modelsPromise) {
      console.error("Models promise not initiated!");
      // Handle error - maybe show message on landing page
      return;
    }
    try {
      this.models = await this.modelsPromise; // Ensure models are loaded
      console.log("Models loaded.");
    } catch (error) {
      console.error("Failed to load models during core initialization:", error);
      // Update landing page with error message
      const loadingText = document.querySelector("#landing-page .loading-text");
      if (loadingText)
        loadingText.textContent = "Error loading assets. Please refresh.";
      // Re-enable start button? Or just stop here.
      document.getElementById("start-game-button")?.removeAttribute("disabled");
      return;
    }

    // Initialize components that depend on models or player settings
    const playerName = localStorage.getItem("playerName") || "Player"; // Get saved name again
    this.activeCharacter = initializeGame.initPlayer(this, playerName); // Use initializer

    if (this.activeCharacter) {
      this.activeCharacter.professions.add(this.playerProfession);
      this.activeCharacter.profession = this.playerProfession;
      this.activeCharacter.updateNameDisplay(playerName); // Update name display after setting it
    } else {
      console.error("Failed to initialize player character!");
      // Handle error
      return;
    }

    this.controls = initializeGame.initControls(this); // Use initializer
    this.mobileControls = initializeGame.initMobileControls(this); // Use initializer
    this.thirdPersonCamera = initializeGame.initCameraAndControls(this); // Use initializer
    this.physics = initializeGame.initPhysics(this); // Use initializer
    initializeGame.initEnvironment(this); // Use initializer
    initializeGame.initSystems(this); // Use initializer
    this.questManager.initQuests();
    initializeGame.initUI(this); // Use initializer
    initializeGame.setupUIControls(this); // Use initializer

    const urlParams = new URLSearchParams(window.location.search);
    this.hasEnteredFromPortal = urlParams.get("portal") === "true";
    this.startPortalRefUrl = urlParams.get("ref");
    this.startPortalOriginalParams = urlParams;
    this.portalManager.initPortals(
      this.scene!,
      this.hasEnteredFromPortal,
      this.startPortalRefUrl,
      this.startPortalOriginalParams
    );

    if (
      this.hasEnteredFromPortal &&
      this.portalManager.startPortal &&
      this.activeCharacter?.mesh
    ) {
      this.activeCharacter.mesh.lookAt(
        this.portalManager.startPortal.group.position
          .clone()
          .add(new Vector3(0, 0, 10))
      );
    }

    if (this.minimap) {
      this.minimap.setPortals(
        this.portalManager.exitPortal?.group || null,
        this.portalManager.startPortal?.group || null
      );
    }

    this.entities.forEach((entity) => {
      if (entity instanceof Character || entity instanceof Animal) {
        entity.game = this;
        if (entity instanceof Character) {
          entity.initIntentDisplay();
          entity.initNameDisplay();
        } else if (entity instanceof Animal) {
          entity.initNameDisplay();
        }
      }
    });

    // Give starting weapon *after* player is fully initialized
    this.giveStartingWeapon();

    // --- Phase 6: Hide Landing Page & Start Game ---
    const landingPage = document.getElementById("landing-page");
    const gameContainer = document.getElementById("game-container");
    const uiContainer = document.getElementById("ui-container");

    landingPage?.classList.add("hidden");
    gameContainer?.classList.remove("hidden");
    uiContainer?.classList.remove("hidden");

    this.isGameStarted = true;
    this.isCoreGameInitialized = true; // Mark as initialized

    // Start music
    this.audioElement
      ?.play()
      .catch((e) => console.warn("Background music play failed:", e));

    // Start the animation loop
    this.renderer!.setAnimationLoop(this.update.bind(this));
    console.log("Core game started.");
  }

  handlePointerLockChange(): void {
    if (
      document.pointerLockElement === this.renderer?.domElement &&
      this.audioElement?.paused &&
      this.isGameStarted
    ) {
      this.audioElement
        .play()
        .catch((e) =>
          console.warn("Background music play failed on interaction:", e)
        );
    }
  }

  handleVisibilityChange(): void {
    if (!this.mobileControls?.isActive()) return;
    if (document.visibilityState === "hidden") {
      this.wasPausedBeforeVisibilityChange = this.isPaused;
      this.setPauseState(true);
      console.log("Game paused (mobile) due to visibility change.");
      if (this.audioElement && !this.audioElement.paused)
        this.audioElement.pause();
    } else if (document.visibilityState === "visible") {
      if (!this.wasPausedBeforeVisibilityChange) {
        this.setPauseState(false);
        console.log("Game resumed (mobile) due to visibility change.");
        if (
          this.audioElement &&
          this.audioElement.paused &&
          !this.isPaused &&
          this.isGameStarted
        ) {
          this.audioElement
            .play()
            .catch((e) => console.warn("Audio resume failed", e));
        }
      } else {
        console.log(
          "Game kept paused (mobile) on visibility change because it was already paused."
        );
      }
      this.wasPausedBeforeVisibilityChange = false;
    }
  }

  giveStartingWeapon(): void {
    if (!this.activeCharacter || !this.activeCharacter.inventory) return;

    const startingWeaponId = ProfessionStartingWeapon[this.playerProfession];
    if (startingWeaponId) {
      const addResult = this.activeCharacter.inventory.addItem(
        startingWeaponId,
        1
      );
      if (addResult.totalAdded > 0) {
        console.log(
          `Gave starting weapon ${startingWeaponId} to player for profession ${this.playerProfession}.`
        );
        const weaponDef = getItemDefinition(startingWeaponId);
        if (weaponDef && isWeapon(weaponDef)) {
          // Equip weapon using requestAnimationFrame to ensure model is ready
          // and character is fully integrated into the scene graph.
          requestAnimationFrame(() => {
            this.activeCharacter?.equipWeapon(weaponDef);
          });
        }
      } else {
        console.warn(
          `Could not give starting weapon ${startingWeaponId} to player (inventory full?).`
        );
      }
    }
    this.activeCharacter.inventory?.addItem("coin", 10);
  }

  setPauseState(paused: boolean): void {
    if (this.isPaused === paused) return;

    const landingPageVisible = !document
      .getElementById("landing-page")
      ?.classList.contains("hidden");
    if (landingPageVisible) {
      paused = true;
    }

    if (!paused && this.isUIPaused()) {
      console.log("Attempted to unpause, but UI requires pause.");
      return;
    }

    this.isPaused = paused;

    // Pause/Resume Music
    if (this.audioElement) {
      if (this.isPaused) {
        if (!this.audioElement.paused) {
          this.audioElement.pause();
          this.wasMusicPlayingBeforePause = true;
        } else {
          this.wasMusicPlayingBeforePause = false;
        }
      } else {
        if (this.wasMusicPlayingBeforePause && this.audioElement.paused) {
          this.audioElement
            .play()
            .catch((e) => console.warn("Audio resume failed", e));
        }
        this.wasMusicPlayingBeforePause = false; // Reset flag after attempting resume
      }
    }

    if (!this.mobileControls?.isActive()) {
      if (this.isPaused) {
        if (this.controls?.isPointerLocked) this.controls.unlockPointer();
      } else {
        if (!this.isUIPaused() && !document.pointerLockElement) {
          this.controls?.lockPointer();
        }
      }
    }
    console.log("Game Paused:", this.isPaused);
  }

  isUIPaused(): boolean {
    // Delegate check to UIManager
    return this.uiManager?.isUIPaused() ?? false;
  }

  // Wrapper methods to call UIManager
  showQuestCompletionBanner(quest: Quest): void {
    this.uiManager?.showQuestCompletionBanner(quest);
  }

  showTradeNotification(
    initiator: Character,
    target: Character,
    itemsToGive: InventoryItem[],
    itemsToReceive: InventoryItem[]
  ): void {
    this.uiManager?.showTradeNotification(
      initiator,
      target,
      itemsToGive,
      itemsToReceive
    );
  }

  handleTradeAccept(): void {
    this.uiManager?.handleTradeAccept();
  }

  handleTradeDecline(): void {
    this.uiManager?.handleTradeDecline();
  }

  hideQuestBanner(): void {
    this.uiManager?.hideBanner();
  }

  // Getter for UIManager's banner visibility state
  get isQuestBannerVisible(): boolean {
    return this.uiManager?.isBannerVisible ?? false;
  }

  // Getter for UIManager's banner type state
  get currentBannerType(): "quest" | "trade" | "none" {
    return this.uiManager?.currentBannerType ?? "none";
  }

  handlePlayerAttackInput(): void {
    if (this.isPaused || !this.activeCharacter || !this.combatSystem) return;
    this.profiler.start("handlePlayerAttackInput");
    this.combatSystem.initiateAttack(this.activeCharacter);
    this.profiler.end("handlePlayerAttackInput");
  }

  update(): void {
    // const currentTime = performance.now();
    // const elapsed = currentTime - this.lastUpdateTime;
    // if (elapsed >= this.targetFrameTime) {
    this.profiler.start("Game.update");
    runGameLoopStep(this, this.profiler);
    this.profiler.end("Game.update");
    // this.lastUpdateTime = currentTime;
    // }
  }

  checkRespawn(): void {
    const now = performance.now();
    for (const entity of this.entities) {
      if (
        entity.isDead &&
        entity.deathTimestamp !== null &&
        entity !== this.activeCharacter
      ) {
        const respawnDelay =
          (entity as Character | Animal).respawnDelay ?? 20000;
        if (now - entity.deathTimestamp > respawnDelay) {
          if (typeof (entity as any).respawn === "function") {
            (entity as Character | Animal).respawn();
          } else {
            console.warn(
              `Entity ${entity.name} is dead but has no respawn method.`
            );
          }
        }
      }
    }
  }

  removeEntity(entityToRemove: Entity): void {
    console.log(`Removing entity permanently: ${entityToRemove.name}.`);
    const collidableIndex = this.collidableObjects.findIndex(
      (obj) => obj === entityToRemove.mesh
    );
    if (collidableIndex > -1) this.collidableObjects.splice(collidableIndex, 1);
    const interactableIndex = this.interactableObjects.findIndex(
      (obj) => obj === entityToRemove
    );
    if (interactableIndex > -1)
      this.interactableObjects.splice(interactableIndex, 1);
    entityToRemove.destroy?.();
    const entityIndex = this.entities.findIndex((e) => e === entityToRemove);
    if (entityIndex > -1) this.entities.splice(entityIndex, 1);
    if (this.minimap) this.minimap.entities = this.entities;
  }

  spawnParticleEffect(position: Vector3, colorName: "red" | "green"): void {
    spawnParticleEffect(this, position, colorName);
  }

  respawnPlayer(): void {
    if (!this.activeCharacter || !this.scene) return;
    const respawnMessage = `${this.activeCharacter.name} blacked out and woke up back near the village...`;
    this.logEvent(
      this.activeCharacter,
      "respawn_start",
      respawnMessage,
      undefined,
      {},
      this.activeCharacter.mesh!.position
    );

    this.wolfKillCount = 0;
    const wolfQuest = this.questManager.getQuestById("wolf_slayer");
    if (wolfQuest && !wolfQuest.isCompleted) {
      wolfQuest.objectives.forEach((obj) => (obj.currentCount = 0));
    }

    let respawnPos = new Vector3(0, 0, 10);
    if (this.portalManager.startPortal) {
      respawnPos = this.portalManager.startPortal.group.position
        .clone()
        .add(new Vector3(0, 0, 3));
    }

    this.activeCharacter.respawn();
    this.setPauseState(false);
  }

  switchControlTo(targetCharacter: Character): void {
    if (
      targetCharacter === this.activeCharacter ||
      !targetCharacter.mesh ||
      targetCharacter.isDead ||
      !this.characterSwitchingEnabled
    )
      return;

    const oldPlayer = this.activeCharacter!;
    const newPlayer = targetCharacter;

    const switchMessage = `Switched control to ${newPlayer.name}.`;
    this.logEvent(
      oldPlayer,
      "control_switch_out",
      switchMessage,
      newPlayer.name,
      {},
      oldPlayer.mesh!.position
    );
    this.logEvent(
      newPlayer,
      "control_switch_in",
      `Switched control from ${oldPlayer.name}.`,
      oldPlayer.name,
      {},
      newPlayer.mesh!.position
    );

    oldPlayer.userData.isPlayer = false;
    oldPlayer.userData.isNPC = true;
    newPlayer.userData.isPlayer = true;
    newPlayer.userData.isNPC = false;

    if (!oldPlayer.aiController) {
      console.warn(
        `Creating AIController for ${oldPlayer.name} on switch-out.`
      );
      oldPlayer.aiController = new AIController(oldPlayer);
      oldPlayer.aiController.persona = oldPlayer.persona;
    }
    if (oldPlayer.aiController instanceof AIController) {
      oldPlayer.aiController.aiState = "idle";
      oldPlayer.aiController.previousAiState = "idle";
    }
    if (newPlayer.aiController) newPlayer.aiController = null;

    oldPlayer.initIntentDisplay();
    oldPlayer.initNameDisplay();
    newPlayer.removeDisplays();

    this.activeCharacter = newPlayer;
    this.controls!.player = newPlayer;
    this.thirdPersonCamera!.target = newPlayer.mesh!;
    this.physics!.player = newPlayer;
    this.interactionSystem!.player = newPlayer;
    this.hud!.player = newPlayer;
    this.minimap!.player = newPlayer;

    this.inventory = newPlayer.inventory;
    this.inventoryDisplay!.setInventory(this.inventory!);
    this.interactionSystem!.inventory = newPlayer.inventory!;
    this.interactionSystem!.eventLog = newPlayer.eventLog;
    this.journalDisplay!.setEventLog(newPlayer.eventLog);

    this.inventoryDisplay!.hide();
    this.journalDisplay!.hide();
    this.interactionSystem!.closeChatInterface();
    this.setPauseState(false);

    console.log(`Control switched to: ${newPlayer.name}`);
  }

  onWindowResize(): void {
    if (this.camera && this.renderer) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  logEvent(
    actor: Entity | string,
    action: string,
    message: string,
    target?: Entity | string | Object3D,
    details: Record<string, any> = {},
    location?: Vector3
  ): void {
    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const actorId = typeof actor === "string" ? actor : actor.id;
    const actorName = typeof actor === "string" ? actor : actor.name;

    let targetId: string | undefined;
    let targetName: string | undefined;
    if (typeof target === "string") {
      targetId = target;
      targetName = target;
    } else if (target instanceof Entity) {
      targetId = target.id;
      targetName = target.name;
    } else if (target instanceof Object3D) {
      targetId = target.uuid;
      targetName = target.name || target.userData?.resource || "Object";
    }

    const eventEntry: EventEntry = {
      timestamp,
      message,
      actorId,
      actorName,
      action,
      targetId,
      targetName,
      details,
      location: location?.clone(),
    };

    this.entities.forEach((entity) => {
      if (entity instanceof Character && entity.eventLog) {
        entity.eventLog.addEntry(eventEntry);
      }
    });
  }

  dropItem(itemId: string, count: number, position: Vector3): void {
    if (!this.droppedItemManager) {
      console.error("DroppedItemManager not initialized.");
      return;
    }
    this.droppedItemManager.createDroppedItem(itemId, count, position);
  }

  executeTrade(
    initiatorId: string,
    targetId: string,
    itemsToGive: InventoryItem[],
    itemsToReceive: InventoryItem[]
  ): boolean {
    if (!this.tradingSystem) {
      console.error("Trading system not initialized.");
      return false;
    }

    const initiator = this.entities.find(
      (e) => e instanceof Character && e.id === initiatorId
    ) as Character | undefined;
    const target = this.entities.find(
      (e) => e instanceof Character && e.id === targetId
    ) as Character | undefined;

    if (!initiator || !target) {
      console.warn(
        `Trade execution failed: Could not find initiator (${initiatorId}) or target (${targetId}).`
      );
      return false;
    }

    console.warn(
      "Game.executeTrade called directly. Use TradingSystem methods instead."
    );
    return this.tradingSystem.executeTrade(
      initiator,
      target,
      itemsToGive,
      itemsToReceive
    );
  }

  destroy(): void {
    document.removeEventListener(
      "visibilitychange",
      this.boundHandleVisibilityChange
    );
    this.renderer?.setAnimationLoop(null);
    this.controls?.dispose();
    this.mobileControls?.destroy();
    this.inventoryDisplay?.destroy();
    this.journalDisplay = null;
    this.notificationManager?.dispose();
    this.droppedItemManager?.dispose();
    this.entities.forEach((entity) => entity.destroy?.());
    this.scene?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose());
        } else if (object.material) {
          object.material.dispose();
        }
      } else if (object instanceof THREE.Sprite) {
        object.material?.map?.dispose();
        object.material?.dispose();
      }
    });
    this.renderer?.dispose();
    const gameContainer = document.getElementById("game-container");
    if (gameContainer && this.renderer) {
      gameContainer.removeChild(this.renderer.domElement);
    }

    this.scene = null;
    this.renderer = null;
    this.camera = null;
    this.clock = null;
    this.activeCharacter = null;
    this.entities = [];
    this.collidableObjects = [];
    this.interactableObjects = [];
    this.particleEffects = [];
    this.tradingSystem = null;
    this.droppedItemManager = null;
    this.combatSystem = null;
    this.uiManager = null; // Nullify UIManager
    console.log("Game destroyed.");
  }
}

declare global {
  interface Window {
    game: Game;
  }
}

if (WebGL.isWebGL2Available()) {
  async function startGame() {
    const gameInstance = new Game();
    window.game = gameInstance;
    try {
      await gameInstance.init();
    } catch (error) {
      console.error("Failed to initialize game:", error);
      const errorElement = document.createElement("div");
      errorElement.textContent = `Failed to initialize game: ${error}`;
      errorElement.style.color = "red";
      errorElement.style.padding = "20px";
      document.body.appendChild(errorElement);
      document.getElementById("landing-page")?.classList.add("hidden");
    }
  }
  startGame();
} else {
  const warning = WebGL.getWebGLErrorMessage();
  document.getElementById("game-container")?.appendChild(warning);
}
