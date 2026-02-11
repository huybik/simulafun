// systems/interaction.ts
import {
  PerspectiveCamera,
  Object3D,
  Vector3,
  Raycaster,
  Vector2,
} from "three";
import { Character } from "../entities/character";
import {
  Inventory,
  EventLog,
  InteractionResult,
  TargetInfo,
} from "../core/utils";
import { Controls } from "../controls/controls";
import { Game } from "../main";
import { sendToGemini, generateChatPrompt } from "../ai/api";
import { INTERACTION_DISTANCE, AIM_TOLERANCE } from "../core/constants";
import { DroppedItemManager, DroppedItemData } from "./droppedItemManager";
import { getItemDefinition } from "../core/items";

export class InteractionSystem {
  player: Character;
  camera: PerspectiveCamera;
  interactableEntities: Array<any>;
  controls: Controls;
  inventory: Inventory;
  eventLog: EventLog;
  raycaster: Raycaster;
  interactionDistance: number = INTERACTION_DISTANCE;
  aimTolerance: number = AIM_TOLERANCE;
  currentTarget: any | null = null;
  currentTargetMesh: Object3D | null = null;
  currentTargetType: "character" | "item" | "none" = "none";
  interactionPromptElement: HTMLElement | null;
  promptTimeout: ReturnType<typeof setTimeout> | null = null;
  game: Game;
  chatContainer: HTMLElement | null;
  chatInput: HTMLInputElement | null;
  chatMessagesEl: HTMLElement | null;
  chatSuggestionsContainer: HTMLElement | null;
  chatSuggestionsList: HTMLElement | null;
  isChatOpen: boolean = false;
  chatTarget: Character | null = null;
  boundSendMessage: (() => Promise<void>) | null = null;
  boundHandleChatKeyDown: ((e: KeyboardEvent) => void) | null = null;
  boundHandleChatInput: (() => void) | null = null;
  boundHandleChatFocus: (() => void) | null = null;
  boundHandleChatBlur: (() => void) | null = null;
  boundHandleSuggestionClick: ((e: MouseEvent) => void) | null = null;
  droppedItemManager: DroppedItemManager;
  public isSwitchTargetAvailable: boolean = false;

  private chatHistoryMap: Map<string, Array<{ role: string; text: string }>> =
    new Map();

  private cameraDirection = new Vector3();
  private objectDirection = new Vector3();
  private playerDirection = new Vector3();
  private objectPosition = new Vector3();

  constructor(
    player: Character,
    camera: PerspectiveCamera,
    interactableEntities: Array<any>,
    controls: Controls,
    inventory: Inventory,
    eventLog: EventLog,
    game: Game,
    droppedItemManager: DroppedItemManager
  ) {
    this.player = player;
    this.camera = camera;
    this.interactableEntities = interactableEntities;
    this.controls = controls;
    this.inventory = inventory;
    this.eventLog = eventLog;
    this.game = game;
    this.droppedItemManager = droppedItemManager;
    this.raycaster = new Raycaster();
    this.interactionPromptElement =
      document.getElementById("interaction-prompt");
    this.chatContainer = document.getElementById("chat-container");
    this.chatInput = document.getElementById("chat-input") as HTMLInputElement;
    this.chatMessagesEl = document.getElementById("chat-messages");
    this.chatSuggestionsContainer = document.getElementById(
      "chat-suggestions-container"
    );
    this.chatSuggestionsList = document.getElementById("chat-suggestions-list");

    const closeBtn = document.getElementById("chat-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.closeChatInterface());
    }

    this.boundHandleChatInput = this.handleChatInput.bind(this);
    this.boundHandleChatFocus = this.handleChatFocus.bind(this);
    this.boundHandleChatBlur = this.handleChatBlur.bind(this);
    this.boundHandleSuggestionClick = this.handleSuggestionClick.bind(this);

    if (this.chatInput) {
      this.chatInput.addEventListener("input", this.boundHandleChatInput);
      this.chatInput.addEventListener("focus", this.boundHandleChatFocus);
      this.chatInput.addEventListener("blur", this.boundHandleChatBlur);
    }
    if (this.chatSuggestionsList) {
      this.chatSuggestionsList.addEventListener(
        "mousedown",
        this.boundHandleSuggestionClick
      );
    }
  }

  update(deltaTime: number): void {
    if (this.isChatOpen) {
      if (this.interactionPromptElement?.style.display !== "none") {
        this.hidePrompt();
      }
      return;
    }

    const characterTargetInfo = this.findInteractableCharacterTarget();
    const itemTargetData = this.droppedItemManager.findClosestItemToPlayer(
      this.player.mesh!.position,
      this.interactionDistance * this.interactionDistance
    );

    let newTarget: any | null = null;
    let newTargetMesh: Object3D | null = null;
    let newTargetType: "character" | "item" | "none" = "none";
    let promptText: string | null = null;
    let canSwitchToTarget = false;

    if (characterTargetInfo) {
      newTarget = characterTargetInfo.instance;
      newTargetMesh = characterTargetInfo.mesh;
      newTargetType = "character";
      promptText =
        characterTargetInfo.instance.userData.prompt ||
        (this.game.mobileControls?.isActive()
          ? "Tap Interact"
          : "Press E to talk");
      canSwitchToTarget =
        this.game.characterSwitchingEnabled &&
        newTarget instanceof Character &&
        newTarget !== this.player &&
        !newTarget.isDead;
    } else if (itemTargetData) {
      newTarget = itemTargetData;
      newTargetMesh = null;
      newTargetType = "item";
      const itemDef = getItemDefinition(itemTargetData.itemId);
      const itemName = itemDef ? itemDef.name : itemTargetData.itemId;
      promptText = this.game.mobileControls?.isActive()
        ? `Tap Interact to pick up ${itemName}`
        : `Press E to pick up ${itemName}`;
    }

    if (
      newTarget !== this.currentTarget ||
      newTargetType !== this.currentTargetType
    ) {
      this.currentTarget = newTarget;
      this.currentTargetMesh = newTargetMesh;
      this.currentTargetType = newTargetType;

      if (promptText) {
        this.showPrompt(promptText);
      } else {
        this.hidePrompt();
      }
    }

    this.isSwitchTargetAvailable = canSwitchToTarget;

    if (this.controls.moveState.interact && this.currentTarget) {
      this.tryInteract(this.currentTarget, this.currentTargetType);
      this.controls.moveState.interact = false;
    }
  }

  findInteractableCharacterTarget(): TargetInfo | null {
    const playerPosition = this.player.mesh!.position;
    let closestDistSq = this.interactionDistance * this.interactionDistance;
    let closestCharacter: Character | null = null;

    for (const entity of this.interactableEntities) {
      if (
        !(entity instanceof Character) ||
        entity === this.player ||
        entity.isDead ||
        !entity.mesh ||
        !entity.mesh.visible
      ) {
        continue;
      }

      const targetPosition = entity.mesh.getWorldPosition(new Vector3());
      const distSq = playerPosition.distanceToSquared(targetPosition);

      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closestCharacter = entity;
      }
    }

    if (closestCharacter) {
      const mesh = closestCharacter.mesh!;
      const position = mesh.getWorldPosition(new Vector3());
      return {
        mesh: mesh,
        instance: closestCharacter,
        point: position.clone(),
        distance: Math.sqrt(closestDistSq),
      };
    }

    return null;
  }

  tryInteract(target: any, targetType: "character" | "item" | "none"): void {
    if (targetType === "character") {
      if (!(target instanceof Character) || target.isDead) {
        this.showPrompt("Cannot interact with this.", 2000);
        return;
      }
      const targetPosition = target.mesh!.position;
      const distance = this.player.mesh!.position.distanceTo(targetPosition);
      if (distance > this.interactionDistance * 1.1) {
        this.currentTarget = null;
        this.currentTargetMesh = null;
        this.currentTargetType = "none";
        this.hidePrompt();
        return;
      }
      this.player.lookAt(target.mesh!.position);
      const result = target.interact(this.player);
      if (result) this.handleInteractionResult(result, target);
    } else if (targetType === "item") {
      const itemData = target as DroppedItemData;
      const success = this.droppedItemManager.collectItem(
        itemData.id,
        this.player
      );
      if (success) {
        this.currentTarget = null;
        this.currentTargetMesh = null;
        this.currentTargetType = "none";
        this.hidePrompt();
      }
    }
  }

  handleInteractionResult(
    result: InteractionResult,
    targetInstance: any
  ): void {
    let promptDuration: number | null = 2000;
    let promptText: string | null = null;
    switch (result.type) {
      case "reward":
        if (result.item) {
          promptText =
            result.message ||
            `Received ${result.item.amount} ${result.item.name}.`;
          promptDuration = 3000;
        } else if (result.message) {
          promptText = result.message;
          promptDuration = 3000;
        }
        break;
      case "message":
        if (result.message) promptText = result.message;
        break;
      case "dialogue":
        if (result.text) {
          promptText = `${targetInstance.name ?? "NPC"}: ${result.text}`;
          promptDuration = 4000;
        }
        break;
      case "chat":
        if (targetInstance instanceof Character) {
          this.openChatInterface(targetInstance);
          promptDuration = null;
        } else {
          promptText = "Cannot chat with this.";
        }
        break;
      case "item_retrieved":
        promptDuration = null;
        break;
      case "error":
        if (result.message) promptText = result.message;
        break;
    }
    if (promptText && promptDuration !== null)
      this.showPrompt(promptText, promptDuration);
  }

  showPrompt(text: string, duration: number | null = null): void {
    if (!this.interactionPromptElement) return;

    this.interactionPromptElement.textContent = text;
    this.interactionPromptElement.style.display = "block";

    clearTimeout(this.promptTimeout ?? undefined);
    this.promptTimeout = null;

    if (duration && duration > 0) {
      this.promptTimeout = setTimeout(() => {
        if (this.interactionPromptElement?.textContent === text) {
          this.hidePrompt();
        }
      }, duration);
    }
  }

  hidePrompt(): void {
    if (!this.interactionPromptElement) return;
    this.interactionPromptElement.style.display = "none";
    this.interactionPromptElement.textContent = "";
    clearTimeout(this.promptTimeout ?? undefined);
    this.promptTimeout = null;
  }

  handleChatInput(): void {
    if (this.chatInput && this.chatInput.value.trim() !== "") {
      this.hideChatSuggestions();
    } else {
      this.showChatSuggestions();
    }
  }

  handleChatFocus(): void {
    if (this.chatInput && this.chatInput.value.trim() === "") {
      this.showChatSuggestions();
    }
  }

  handleChatBlur(): void {
    setTimeout(() => {
      if (
        document.activeElement !== this.chatInput &&
        !this.chatSuggestionsContainer?.contains(document.activeElement)
      ) {
        this.hideChatSuggestions();
      }
    }, 150);
  }

  handleSuggestionClick(event: MouseEvent): void {
    event.preventDefault();
    const target = event.target as HTMLElement;
    if (target.tagName === "LI" && this.chatInput) {
      const command = target.dataset.command;
      if (command) {
        const currentValue = this.chatInput.value;
        const newValue = command + " " + currentValue;
        this.chatInput.value = newValue;

        requestAnimationFrame(() => {
          this.chatInput!.focus();
          if (document.activeElement !== this.chatInput) {
            this.chatInput!.focus();
          }
          this.chatInput!.selectionStart = this.chatInput!.selectionEnd =
            newValue.length;
          this.hideChatSuggestions();
        });
      }
    }
  }

  showChatSuggestions(): void {
    if (this.chatSuggestionsContainer && this.isChatOpen) {
      this.chatSuggestionsContainer.classList.remove("hidden");
    }
  }

  hideChatSuggestions(): void {
    if (this.chatSuggestionsContainer) {
      this.chatSuggestionsContainer.classList.add("hidden");
    }
  }

  private addChatBubble(sender: string, text: string, isPlayer: boolean): void {
    if (!this.chatMessagesEl) return;
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isPlayer ? "player" : "npc"}`;
    const senderEl = document.createElement("div");
    senderEl.className = "chat-sender";
    senderEl.textContent = sender;
    const textEl = document.createElement("div");
    textEl.textContent = text;
    bubble.appendChild(senderEl);
    bubble.appendChild(textEl);
    this.chatMessagesEl.appendChild(bubble);
    this.chatMessagesEl.scrollTop = this.chatMessagesEl.scrollHeight;
  }

  async openChatInterface(target: Character): Promise<void> {
    if (this.chatInput) {
      this.chatInput.disabled = false;
      this.chatInput.value = "";
    }

    if (!this.chatContainer || !this.chatInput || this.isChatOpen) {
      if (this.isChatOpen && this.chatInput && !this.chatInput.disabled) {
        requestAnimationFrame(() => {
          this.chatInput?.focus();
        });
      }
      return;
    }

    this.isChatOpen = true;
    this.chatTarget = target;
    this.chatContainer.classList.remove("hidden");
    this.controls.unlockPointer();
    this.handleChatInput();

    // Restore chat history for this character
    if (this.chatMessagesEl) {
      this.chatMessagesEl.innerHTML = "";
      const history = this.chatHistoryMap.get(target.id) || [];
      for (const msg of history) {
        const isPlayer = msg.role === "player";
        const sender = isPlayer ? this.player.name : target.name;
        this.addChatBubble(sender, msg.text, isPlayer);
      }
    }

    // Make NPC face player and idle during conversation
    target.lookAt(this.player.mesh!.position);
    if (target.aiController) {
      target.aiController.aiState = "idle";
      target.aiController.persistentAction = null;
    }

    // Frame camera on conversation
    this.game.thirdPersonCamera?.setConversationTarget(target.mesh!);

    if (this.chatInput) {
      setTimeout(() => {
        this.chatInput?.focus();
      }, 100);
    }

    if (!this.boundSendMessage) {
      this.boundSendMessage = async () => {
        if (!this.chatTarget || !this.chatInput) return;
        const message = this.chatInput.value.trim();
        if (!message) return;
        await this.processChatMessage(message, this.chatTarget);
      };
    }

    if (!this.boundHandleChatKeyDown) {
      this.boundHandleChatKeyDown = (e: KeyboardEvent) => {
        if (
          e.key === "Enter" &&
          this.boundSendMessage &&
          !this.chatInput?.disabled
        ) {
          this.boundSendMessage();
        }
      };
    }

    this.chatInput.removeEventListener("keydown", this.boundHandleChatKeyDown);
    this.chatInput.addEventListener("keydown", this.boundHandleChatKeyDown);
  }

  closeChatInterface(): void {
    if (!this.isChatOpen || !this.chatContainer || !this.chatInput) return;

    // Resume NPC AI
    this.chatTarget?.aiController?.scheduleNextActionDecision();

    this.isChatOpen = false;
    this.chatTarget = null;
    this.chatContainer.classList.add("hidden");
    this.hideChatSuggestions();
    this.chatInput.disabled = false;
    this.chatInput.blur();

    if (this.boundHandleChatKeyDown) {
      this.chatInput.removeEventListener(
        "keydown",
        this.boundHandleChatKeyDown
      );
    }

    // Return camera to normal
    this.game.thirdPersonCamera?.setConversationTarget(null);

    // Re-lock pointer on desktop
    this.controls.lockPointer();
  }

  private async processChatMessage(
    message: string,
    target: Character
  ): Promise<void> {
    if (!target || !message.trim()) return;

    const targetAtSendStart = target;
    const charId = targetAtSendStart.id;
    if (!this.chatHistoryMap.has(charId)) {
      this.chatHistoryMap.set(charId, []);
    }
    const history = this.chatHistoryMap.get(charId)!;

    this.addChatBubble(this.player.name, message, true);
    history.push({ role: "player", text: message });

    this.player.updateIntentDisplay(message);
    this.game.logEvent(
      this.player,
      "chat",
      `${this.player.name} said "${message}" to ${targetAtSendStart.name}.`,
      targetAtSendStart,
      { message: message },
      this.player.mesh!.position
    );

    this.chatInput!.value = "";
    this.chatInput!.disabled = true;
    this.hideChatSuggestions();

    const prompt = generateChatPrompt(
      targetAtSendStart,
      this.player,
      message,
      history
    );
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
        }
      }
      if (this.isChatOpen && this.chatTarget === targetAtSendStart) {
        this.addChatBubble(targetAtSendStart.name, npcMessage, false);
        history.push({ role: "npc", text: npcMessage });

        targetAtSendStart.updateIntentDisplay(npcMessage);
        this.game.logEvent(
          targetAtSendStart,
          "chat",
          `${targetAtSendStart.name} said "${npcMessage}" to ${this.player.name}.`,
          this.player,
          { message: npcMessage },
          targetAtSendStart.mesh!.position
        );
        this.game.questManager.checkAllQuestsCompletion();
        this.game.voiceManager?.speak(npcMessage);
      }
    } catch (error) {
      console.error("Error during chat API call:", error);
      if (this.isChatOpen && this.chatTarget === targetAtSendStart) {
        const errorMsg = "I... don't know what to say.";
        this.addChatBubble(targetAtSendStart.name, errorMsg, false);
        targetAtSendStart.updateIntentDisplay(errorMsg);
        this.game.logEvent(
          targetAtSendStart,
          "chat_error",
          `${targetAtSendStart.name} failed to respond to ${this.player.name}.`,
          this.player,
          { error: (error as Error).message },
          targetAtSendStart.mesh!.position
        );
      }
    } finally {
      // Re-enable input for next message (don't close chat)
      if (this.chatInput) {
        this.chatInput.disabled = false;
        this.chatInput.focus();
      }
    }
  }
}
