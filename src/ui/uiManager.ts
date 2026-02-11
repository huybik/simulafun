/* File: /src/ui/uiManager.ts */
import { Game } from "../main";
import { Character } from "../entities/character";
import { Quest, QuestRewardOption, InventoryItem } from "../core/utils";
import { getItemDefinition, Profession } from "../core/items"; // Import Profession

export class UIManager {
  private game: Game;

  // Banner UI Elements
  private bannerElement: HTMLElement | null = null;
  private bannerTitle: HTMLElement | null = null;
  private bannerDesc: HTMLElement | null = null;
  private bannerButtonContainer: HTMLElement | null = null;
  private bannerOkButton: HTMLButtonElement | null = null;
  private bannerAcceptButton: HTMLButtonElement | null = null;
  private bannerDeclineButton: HTMLButtonElement | null = null;
  private bannerRewardButtons: HTMLButtonElement[] = [];

  // Icon Button Elements
  private inventoryButton: HTMLElement | null = null;
  private journalButton: HTMLElement | null = null;

  // Mobile Action Button Elements (for checking clicks)
  private mobileInteractButton: HTMLElement | null = null;
  private mobileAttackButton: HTMLElement | null = null;
  private mobileSwitchButton: HTMLElement | null = null; // Added switch button
  private mobileJoystickZone: HTMLElement | null = null;

  // Banner State
  public isBannerVisible: boolean = false;
  public currentBannerType: "quest" | "trade" | "none" = "none";

  // Store current banner handlers to remove them later
  private boundBannerOkClickHandler: (() => void) | null = null;
  private boundBannerAcceptClickHandler: (() => void) | null = null;
  private boundBannerDeclineClickHandler: (() => void) | null = null;
  private boundRewardButtonHandlers: Map<string, () => void> = new Map();

  // Store current trade/quest context for handlers
  private currentTradeInitiator: Character | null = null;
  private currentTradeTarget: Character | null = null;
  private currentTradeGiveItems: InventoryItem[] = [];
  private currentTradeReceiveItems: InventoryItem[] = [];
  private currentQuestForReward: Quest | null = null;

  constructor(game: Game) {
    this.game = game;
  }

  /** Initializes the UIManager by getting references to UI elements and setting up listeners. */
  init(): void {
    // Banner Elements
    this.bannerElement = document.getElementById("quest-detail-banner");
    this.bannerTitle = document.getElementById("quest-banner-title");
    this.bannerDesc = document.getElementById("quest-banner-description");
    this.bannerButtonContainer = document.getElementById(
      "quest-banner-buttons"
    );
    this.bannerOkButton = document.getElementById(
      "quest-banner-ok"
    ) as HTMLButtonElement;
    this.bannerAcceptButton = document.getElementById(
      "quest-banner-accept"
    ) as HTMLButtonElement;
    this.bannerDeclineButton = document.getElementById(
      "quest-banner-decline"
    ) as HTMLButtonElement;

    // Icon Button Elements
    this.inventoryButton = document.getElementById("button-inventory");
    this.journalButton = document.getElementById("button-journal");

    // Mobile Action Button Elements
    this.mobileInteractButton = document.getElementById("button-interact");
    this.mobileAttackButton = document.getElementById("button-attack");
    this.mobileSwitchButton = document.getElementById("button-switch"); // Get switch button
    this.mobileJoystickZone = document.getElementById("joystick-zone-left");

    // Setup Icon Button Listeners (for both desktop and mobile)
    this.setupIconButtons();
  }

  /** Sets up click listeners for the top-right icon buttons. */
  private setupIconButtons(): void {
    if (this.inventoryButton) {
      this.inventoryButton.addEventListener("click", () => {
        if (
          this.game.interactionSystem?.isChatOpen ||
          this.isBannerVisible // Check UIManager's banner state
        )
          return;
        this.game.journalDisplay?.hide();
        this.game.inventoryDisplay?.toggle();
        // Pause state is handled within inventoryDisplay.toggle() -> show/hide
      });
    } else {
      console.error("Inventory button not found!");
    }

    if (this.journalButton) {
      this.journalButton.addEventListener("click", () => {
        if (
          this.game.interactionSystem?.isChatOpen ||
          this.isBannerVisible // Check UIManager's banner state
        )
          return;
        this.game.inventoryDisplay?.hide();
        this.game.journalDisplay?.toggle();
        // Pause state is handled within journalDisplay.toggle() -> show/hide
      });
    } else {
      console.error("Journal button not found!");
    }
  }

  /** Checks if any UI element that requires pausing is open. */
  isUIPaused(): boolean {
    return (
      this.game.inventoryDisplay?.isOpen ||
      this.game.journalDisplay?.isOpen ||
      this.isBannerVisible
    );
  }

  /**
   * Checks if a click/tap event target is part of the interactable UI.
   * Includes panels, buttons, chat, etc.
   * @param targetElement The HTMLElement that was clicked/tapped.
   * @returns True if the click was on interactable UI, false otherwise.
   */
  isClickOnInteractableUI(targetElement: HTMLElement | null): boolean {
    if (!targetElement) return false;

    // Check against main panels and specific interactive elements
    const isPanelClick =
      targetElement.closest(
        "#inventory-display, #journal-display, #chat-container, #quest-detail-banner"
      ) !== null;

    // Check against top-right icon buttons
    const isIconButtonClick =
      targetElement.closest("#button-inventory, #button-journal") !== null;

    // Check against mobile controls (buttons and joystick zone)
    const isMobileButtonClick =
      targetElement.closest(
        "#button-interact, #button-attack, #button-switch"
      ) !== null; // Added switch button
    const isJoystickZoneClick =
      targetElement.closest("#joystick-zone-left") !== null;

    // Check if click is on the minimap
    const isMinimapClick = targetElement.closest("#minimap-canvas") !== null;

    // Check if click is on chat suggestions
    const isChatSuggestionClick =
      targetElement.closest("#chat-suggestions-list") !== null;

    return (
      isPanelClick ||
      isIconButtonClick ||
      isMobileButtonClick ||
      isJoystickZoneClick ||
      isMinimapClick ||
      isChatSuggestionClick
    );
  }

  /** Closes the topmost open UI element (Chat > Banner > Inventory/Journal). Returns true if something was closed. */
  closeTopmostUI(): boolean {
    if (this.game.interactionSystem?.isChatOpen) {
      this.game.interactionSystem.closeChatInterface();
      return true;
    } else if (this.isBannerVisible) {
      this.hideBanner();
      return true;
    } else if (this.game.inventoryDisplay?.isOpen) {
      this.game.inventoryDisplay.hide();
      return true;
    } else if (this.game.journalDisplay?.isOpen) {
      this.game.journalDisplay.hide();
      return true;
    } else if (this.game.controls?.isPointerLocked) {
      // Only unlock pointer if no UI was closed
      this.game.controls.unlockPointer();
      return true; // Consider unlocking pointer as closing something
    }
    return false;
  }

  /** Closes all open menus (Inventory, Journal, Banner, Chat). Returns true if any menu was closed. */
  closeOpenMenus(): boolean {
    let closedSomething = false;
    if (this.game.inventoryDisplay?.isOpen) {
      this.game.inventoryDisplay.hide();
      closedSomething = true;
    }
    if (this.game.journalDisplay?.isOpen) {
      this.game.journalDisplay.hide();
      closedSomething = true;
    }
    if (this.isBannerVisible) {
      this.hideBanner();
      closedSomething = true;
    }
    if (this.game.interactionSystem?.isChatOpen) {
      this.game.interactionSystem.closeChatInterface();
      closedSomething = true;
    }
    return closedSomething;
  }

  /**
   * Shows the quest/trade banner UI. Handles different button configurations.
   * @param title The title for the banner.
   * @param description The description text or HTML.
   * @param type The type of banner ('quest' or 'trade').
   * @param quest The quest associated with this banner (for reward handling).
   * @param onOk Optional handler for the OK button (for simple quests/info).
   * @param onAccept Optional handler for the Accept button (for trades).
   * @param onDecline Optional handler for the Decline button (for trades).
   * @param rewardOptions Optional array of reward choices.
   */
  private _showBanner(
    title: string,
    description: string, // Can be HTML
    type: "quest" | "trade",
    quest: Quest | null = null,
    onOk?: () => void,
    onAccept?: () => void,
    onDecline?: () => void,
    rewardOptions?: QuestRewardOption[]
  ): void {
    if (
      !this.bannerElement ||
      !this.bannerTitle ||
      !this.bannerDesc ||
      !this.bannerButtonContainer ||
      !this.bannerOkButton ||
      !this.bannerAcceptButton ||
      !this.bannerDeclineButton
    )
      return;

    this._removeBannerListeners();
    this.bannerButtonContainer.innerHTML = ""; // Clear previous buttons
    this.currentQuestForReward = quest;
    this.bannerTitle.textContent = title;
    this.bannerDesc.innerHTML = description;
    this.currentBannerType = type;

    // Ensure buttons are hidden initially before adding the correct ones
    this.bannerOkButton.classList.add("hidden");
    this.bannerAcceptButton.classList.add("hidden");
    this.bannerDeclineButton.classList.add("hidden");

    if (type === "trade") {
      this.bannerButtonContainer.appendChild(this.bannerAcceptButton);
      this.bannerButtonContainer.appendChild(this.bannerDeclineButton);
      this.bannerAcceptButton.classList.remove("hidden");
      this.bannerDeclineButton.classList.remove("hidden");

      if (onAccept) {
        this.boundBannerAcceptClickHandler = () => {
          onAccept();
          this.hideBanner();
        };
        this.bannerAcceptButton.addEventListener(
          "click",
          this.boundBannerAcceptClickHandler
        );
      }
      if (onDecline) {
        this.boundBannerDeclineClickHandler = () => {
          onDecline();
          this.hideBanner();
        };
        this.bannerDeclineButton.addEventListener(
          "click",
          this.boundBannerDeclineClickHandler
        );
      }
    } else if (type === "quest" && rewardOptions && rewardOptions.length > 0) {
      this.bannerRewardButtons = [];
      this.boundRewardButtonHandlers.clear();

      rewardOptions.forEach((option) => {
        const button = document.createElement("button");
        button.textContent = option.name;
        button.classList.add("reward-button");
        button.title = option.description;
        button.dataset.rewardId = option.id;

        const handler = () => {
          this.handleRewardSelection(option.id);
          this.hideBanner();
        };
        this.boundRewardButtonHandlers.set(option.id, handler);
        button.addEventListener("click", handler);

        this.bannerButtonContainer?.appendChild(button);
        this.bannerRewardButtons.push(button);
      });
    } else {
      // Default to OK button for quests without specific rewards or simple info
      this.bannerButtonContainer.appendChild(this.bannerOkButton);
      this.bannerOkButton.classList.remove("hidden");

      const okHandler = onOk ? onOk : () => {}; // Use provided handler or empty function

      this.boundBannerOkClickHandler = () => {
        okHandler();
        this.hideBanner();
      };
      this.bannerOkButton.addEventListener(
        "click",
        this.boundBannerOkClickHandler
      );
    }

    this.bannerElement.classList.remove("hidden");
    this.isBannerVisible = true;
    this.game.setPauseState(true);
  }

  /** Removes all active banner button listeners. */
  private _removeBannerListeners(): void {
    if (this.boundBannerOkClickHandler && this.bannerOkButton) {
      this.bannerOkButton.removeEventListener(
        "click",
        this.boundBannerOkClickHandler
      );
    }
    if (this.boundBannerAcceptClickHandler && this.bannerAcceptButton) {
      this.bannerAcceptButton.removeEventListener(
        "click",
        this.boundBannerAcceptClickHandler
      );
    }
    if (this.boundBannerDeclineClickHandler && this.bannerDeclineButton) {
      this.bannerDeclineButton.removeEventListener(
        "click",
        this.boundBannerDeclineClickHandler
      );
    }
    this.bannerRewardButtons.forEach((button) => {
      const optionId = button.dataset.rewardId;
      const handler = this.boundRewardButtonHandlers.get(optionId || "");
      if (handler) {
        button.removeEventListener("click", handler);
      }
    });

    this.boundBannerOkClickHandler = null;
    this.boundBannerAcceptClickHandler = null;
    this.boundBannerDeclineClickHandler = null;
    this.bannerRewardButtons = [];
    this.boundRewardButtonHandlers.clear();
  }

  /** Hides the quest/trade banner and unpauses the game if appropriate. */
  hideBanner(): void {
    if (!this.bannerElement || !this.isBannerVisible) return;

    this._removeBannerListeners();
    this.bannerElement.classList.add("hidden");
    this.isBannerVisible = false;
    this.currentBannerType = "none";
    this.currentTradeInitiator = null;
    this.currentTradeTarget = null;
    this.currentTradeGiveItems = [];
    this.currentTradeReceiveItems = [];
    this.currentQuestForReward = null;
    // Only unpause if no *other* UI element requires pause
    if (!this.isUIPaused()) {
      this.game.setPauseState(false);
    }
  }

  /**
   * Shows a quest notification or completion banner.
   * @param quest The quest to display.
   */
  showQuestCompletionBanner(quest: Quest): void {
    const title = quest.isCompleted
      ? `Quest Completed: ${quest.name}`
      : `Quest: ${quest.name}`;
    let description = quest.description;

    if (quest.isCompleted) {
      description += "<br><br><strong>Reward:</strong> ";
      switch (quest.rewardType) {
        case "weapon_choice":
          description += "Choose your reward below.";
          break;
        case "weapon_upgrade":
          description += `Weapon Damage +${quest.rewardData || "?"}`;
          break;
        case "enable_mechanic":
          description += `Mechanic Unlocked: ${quest.rewardData || "Unknown"}`;
          if (quest.rewardData === "character_switching") {
            description += " (Press 'C' near an NPC to switch)";
          }
          break;
        case "add_profession":
          description += `New Profession: ${quest.rewardData || "Unknown"}`;
          break;
        case "item_reward":
          const rewardItem = quest.rewardData as
            | { itemId: string; count: number }
            | undefined;
          if (rewardItem) {
            const itemDef = getItemDefinition(rewardItem.itemId);
            description += `${rewardItem.count}x ${itemDef ? itemDef.name : rewardItem.itemId}`;
          } else {
            description += "Unknown Item";
          }
          break;
        default:
          description += "Claim your reward!";
      }
    }

    this._showBanner(
      title,
      description,
      "quest",
      quest,
      () => this.handleRewardSelection(), // Pass handler for OK button
      undefined,
      undefined,
      quest.isCompleted ? quest.rewardOptions : undefined
    );
  }

  /** Handles the reward selection or acknowledgement. */
  handleRewardSelection(selectedOptionId?: string): void {
    const quest = this.currentQuestForReward;
    const player = this.game.activeCharacter;
    if (!quest || !quest.isCompleted || !player) {
      console.warn("Cannot handle reward: No active quest or player.");
      return;
    }

    console.log(
      `Handling reward for quest: ${quest.name}, Option: ${selectedOptionId}`
    );

    switch (quest.rewardType) {
      case "weapon_choice":
        if (!selectedOptionId) {
          console.warn(
            "Weapon choice reward selected but no option ID provided."
          );
          return;
        }
        if (selectedOptionId === "new_sword") {
          const addResult = player.inventory?.addItem("sword", 1);
          if (addResult?.totalAdded) {
            this.game.notificationManager?.createItemAddedSprite(
              "sword",
              1,
              player.mesh!.position
            );
            this.game.logEvent(
              player,
              "reward_received",
              `Received reward: New Sword`,
              undefined,
              { quest: quest.name, reward: "New Sword" },
              player.mesh!.position
            );
          } else {
            this.game.logEvent(
              player,
              "reward_fail",
              `Failed to receive reward: New Sword (Inventory Full?)`,
              undefined,
              { quest: quest.name, reward: "New Sword" },
              player.mesh!.position
            );
          }
        } else if (selectedOptionId === "upgrade_damage") {
          player.upgradeWeaponDamage(5);
          this.game.logEvent(
            player,
            "reward_received",
            `Received reward: Damage Upgrade`,
            undefined,
            { quest: quest.name, reward: "Damage Upgrade" },
            player.mesh!.position
          );
        }
        break;

      case "weapon_upgrade":
        const upgradeAmount = (quest.rewardData as number) || 5;
        player.upgradeWeaponDamage(upgradeAmount);
        this.game.logEvent(
          player,
          "reward_received",
          `Received reward: Damage Upgrade (+${upgradeAmount})`,
          undefined,
          { quest: quest.name, reward: `Damage Upgrade +${upgradeAmount}` },
          player.mesh!.position
        );
        break;

      case "enable_mechanic":
        if (quest.rewardData === "character_switching") {
          this.game.characterSwitchingEnabled = true;
          console.log("Character switching enabled!");
          this.game.logEvent(
            player,
            "reward_received",
            `Received reward: Character Switching Unlocked`,
            undefined,
            { quest: quest.name, reward: "Character Switching" },
            player.mesh!.position
          );
        }
        break;

      case "add_profession":
        const professionToAdd = quest.rewardData as Profession | undefined;
        if (professionToAdd) {
          player.addProfession(professionToAdd);
          this.game.logEvent(
            player,
            "reward_received",
            `Received reward: Profession - ${professionToAdd}`,
            undefined,
            { quest: quest.name, reward: `Profession: ${professionToAdd}` },
            player.mesh!.position
          );
        }
        break;

      case "item_reward":
        const rewardItem = quest.rewardData as
          | { itemId: string; count: number }
          | undefined;
        if (rewardItem && player.inventory) {
          const addResult = player.inventory.addItem(
            rewardItem.itemId,
            rewardItem.count
          );
          const itemDef = getItemDefinition(rewardItem.itemId);
          const itemName = itemDef ? itemDef.name : rewardItem.itemId;
          if (addResult.totalAdded > 0) {
            this.game.notificationManager?.createItemAddedSprite(
              rewardItem.itemId,
              addResult.totalAdded,
              player.mesh!.position
            );
            this.game.logEvent(
              player,
              "reward_received",
              `Received reward: ${addResult.totalAdded}x ${itemName}`,
              undefined,
              {
                quest: quest.name,
                reward: `${addResult.totalAdded}x ${itemName}`,
              },
              player.mesh!.position
            );
          } else {
            this.game.logEvent(
              player,
              "reward_fail",
              `Failed to receive reward: ${rewardItem.count}x ${itemName} (Inventory Full?)`,
              undefined,
              { quest: quest.name, reward: `${rewardItem.count}x ${itemName}` },
              player.mesh!.position
            );
          }
        }
        break;
    }
  }

  /**
   * Shows a trade offer notification banner.
   * @param initiator The NPC initiating the trade.
   * @param target The Player receiving the offer.
   * @param itemsToGive Items the NPC wants to give (Player receives).
   * @param itemsToReceive Items the NPC wants to receive (Player gives).
   */
  showTradeNotification(
    initiator: Character,
    target: Character,
    itemsToGive: InventoryItem[],
    itemsToReceive: InventoryItem[]
  ): void {
    if (!this.game.tradingSystem) return;

    this.currentTradeInitiator = initiator;
    this.currentTradeTarget = target;
    this.currentTradeGiveItems = [...itemsToGive];
    this.currentTradeReceiveItems = [...itemsToReceive];

    const title = `Trade Offer from ${initiator.name}`;
    const formatItems = (items: InventoryItem[]) =>
      items
        .map((i) => {
          const def = getItemDefinition(i.id);
          return `${i.count}x ${def ? def.name : i.id}`;
        })
        .join(", ") || "Nothing";

    const giveDesc = formatItems(itemsToGive);
    const receiveDesc = formatItems(itemsToReceive);

    const descriptionHTML = `
            You Receive: <span class="trade-item-receive">${giveDesc}</span>
            <br>
            You Give: <span class="trade-item-give">${receiveDesc}</span>
        `;

    this._showBanner(
      title,
      descriptionHTML,
      "trade",
      null,
      undefined,
      () => this.handleTradeAccept(),
      () => this.handleTradeDecline()
    );
  }

  /** Handles the logic when the player clicks "Accept" on a trade offer. */
  handleTradeAccept(): void {
    if (
      !this.game.tradingSystem ||
      !this.currentTradeInitiator ||
      !this.currentTradeTarget
    )
      return;

    const success = this.game.tradingSystem.executeTrade(
      this.currentTradeInitiator,
      this.currentTradeTarget,
      this.currentTradeGiveItems,
      this.currentTradeReceiveItems
    );

    if (success) {
      console.log("Trade accepted and executed successfully.");
    } else {
      console.log("Trade accepted but failed during execution.");
    }
  }

  /** Handles the logic when the player clicks "Decline" on a trade offer. */
  handleTradeDecline(): void {
    if (
      !this.game.tradingSystem ||
      !this.currentTradeInitiator ||
      !this.currentTradeTarget
    )
      return;

    this.game.tradingSystem.declineTrade(
      this.currentTradeInitiator,
      this.currentTradeTarget
    );
  }
}
