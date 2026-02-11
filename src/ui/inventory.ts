/* File: /src/ui/inventory.ts */
import { Inventory, InventoryItem } from "../core/utils";
import {
  getItemDefinition,
  isWeapon,
  isConsumable,
  AnyItemDefinition,
} from "../core/items"; // Import item definitions and type guards
import { Game } from "../main"; // Import Game to access player

export class InventoryDisplay {
  inventory: Inventory;
  game: Game; // Add reference to Game
  displayElement: HTMLElement | null;
  slotsContainer: HTMLElement | null;
  descriptionPanel: HTMLElement | null; // Element to show description
  descriptionTitle: HTMLElement | null;
  descriptionText: HTMLElement | null;
  isOpen: boolean = false;
  boundUpdateDisplay: (items: Array<InventoryItem | null>) => void;
  boundHandleSlotClick: (event: MouseEvent) => void; // Declare type
  selectedItemIndex: number | null = null; // Track the index of the item whose description is shown

  constructor(inventory: Inventory, game: Game) {
    // Accept Game instance
    this.inventory = inventory;
    this.game = game; // Store Game instance
    this.displayElement = document.getElementById("inventory-display");
    this.slotsContainer = document.getElementById("inventory-slots");
    this.descriptionPanel = document.getElementById("item-description-panel");
    this.descriptionTitle = document.getElementById("item-description-title");
    this.descriptionText = document.getElementById("item-description-text");

    // Initialize bound function here to ensure it's always assigned
    this.boundHandleSlotClick = this.handleSlotClick.bind(this);
    this.boundUpdateDisplay = this.updateDisplay.bind(this);

    const closeBtn = this.displayElement?.querySelector(".menu-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.hide());
    }

    if (this.slotsContainer) {
      this.createSlots();
      // Use event delegation on the container for clicks
      this.slotsContainer.addEventListener("click", this.boundHandleSlotClick);
    }

    this.inventory.onChange(this.boundUpdateDisplay);
    if (this.displayElement) this.displayElement.classList.add("hidden");
    if (this.descriptionPanel) this.descriptionPanel.classList.add("hidden");
  }

  setInventory(newInventory: Inventory): void {
    if (this.inventory === newInventory) return;
    // Unregister old listener
    if (this.inventory) {
      this.inventory.onChangeCallbacks =
        this.inventory.onChangeCallbacks.filter(
          (cb) => cb !== this.boundUpdateDisplay
        );
    }
    // Register new listener
    this.inventory = newInventory;
    this.inventory.onChange(this.boundUpdateDisplay);
    // Update display if open or if slot count needs changing
    if (this.isOpen) {
      this.updateDisplay(this.inventory.items);
    } else if (
      this.slotsContainer &&
      this.slotsContainer.children.length !== this.inventory.size
    ) {
      this.createSlots(); // Recreate slots if size differs
    }
    this.selectedItemIndex = null; // Reset selection when inventory changes
    this.hideItemDescription();
  }

  createSlots(): void {
    if (!this.slotsContainer) return;
    this.slotsContainer.innerHTML = ""; // Clear existing slots
    for (let i = 0; i < this.inventory.size; i++) {
      const slotElement = document.createElement("div");
      slotElement.classList.add("inventory-slot");
      slotElement.dataset.index = i.toString();
      slotElement.title = "Empty"; // Basic tooltip

      // Structure for icon and count
      slotElement.innerHTML = `<div class="item-icon" data-item-id="empty"></div><span class="item-count"></span>`;
      this.slotsContainer.appendChild(slotElement);
    }
  }

  updateDisplay(items: Array<InventoryItem | null>): void {
    if (!this.isOpen || !this.slotsContainer) return;
    const slotElements =
      this.slotsContainer.querySelectorAll<HTMLElement>(".inventory-slot");

    // Ensure the number of slots matches the inventory size
    if (slotElements.length !== this.inventory.size) {
      this.createSlots(); // Recreate slots if size mismatch
      // Re-query elements after creation
      const newSlotElements =
        this.slotsContainer.querySelectorAll<HTMLElement>(".inventory-slot");
      this.updateSlotsContent(items, newSlotElements); // Update content of new slots
    } else {
      this.updateSlotsContent(items, slotElements); // Update content of existing slots
    }
  }

  // Helper function to update slot content
  private updateSlotsContent(
    items: Array<InventoryItem | null>,
    slotElements: NodeListOf<HTMLElement>
  ): void {
    items.forEach((item, index) => {
      const slotElement = slotElements[index];
      if (!slotElement) return; // Should not happen if lengths match
      const iconElement = slotElement.querySelector<HTMLElement>(".item-icon");
      const countElement =
        slotElement.querySelector<HTMLElement>(".item-count");

      if (item && iconElement && countElement) {
        const definition = getItemDefinition(item.id);
        const iconPath = definition
          ? `assets/items/icons/${definition.icon}`
          : "";

        // Update icon using background image for better performance and easier styling
        if (iconElement.dataset.itemId !== item.id) {
          iconElement.style.backgroundImage = iconPath
            ? `url('${iconPath}')`
            : "none";
          // Optional: set a background color if icon fails to load or for specific items
          iconElement.style.backgroundColor = iconPath ? "transparent" : "#ccc";
          iconElement.dataset.itemId = item.id;
        }
        iconElement.style.visibility = "visible";

        // Update count display
        countElement.textContent = item.count > 1 ? item.count.toString() : "";
        // Update tooltip
        slotElement.title = `${item.name}${item.count > 1 ? ` (${item.count})` : ""}`;
      } else if (iconElement && countElement) {
        // Clear the slot if item is null
        if (iconElement.dataset.itemId !== "empty") {
          iconElement.style.backgroundImage = "none";
          iconElement.style.backgroundColor = "transparent"; // Reset background
          iconElement.style.visibility = "hidden";
          iconElement.dataset.itemId = "empty";
        }
        countElement.textContent = "";
        slotElement.title = "Empty"; // Reset tooltip
      }
    });
  }

  handleSlotClick(event: MouseEvent): void {
    const slotElement = (event.target as HTMLElement)?.closest(
      ".inventory-slot"
    ) as HTMLElement | null;
    if (!slotElement) return;

    const index = parseInt(slotElement.dataset.index ?? "-1", 10);
    if (index === -1) return;

    const item = this.inventory.getItem(index);

    // Check if the same item was clicked again
    if (this.selectedItemIndex === index && item) {
      // Second click on the same item: perform action
      this.handleItemAction(index, item);
      // Don't reset selectedItemIndex here, let handleItemAction or hide() do it
    } else {
      // First click on this item, or click on a different item, or click on empty slot
      this.showItemDescription(item); // Show description (or hide if item is null)
      // Update selected index only if an item is present to be described
      this.selectedItemIndex = item ? index : null;
    }
  }

  // Renamed from handleSlotDoubleClick to handleItemAction for clarity
  handleItemAction(index: number, item: InventoryItem | null): void {
    // console.log("Action on index:", index, item);
    if (item && this.game.activeCharacter) {
      this.game.activeCharacter.handleItemAction(index);
      // Description hiding and selection clearing are now handled within Character.handleItemAction
      // if the action results in closing the inventory or unequipping.
      // Otherwise, the description stays visible.
    }
  }

  showItemDescription(item: InventoryItem | null): void {
    // console.log("Show description for:", item);
    if (
      item &&
      this.descriptionPanel &&
      this.descriptionTitle &&
      this.descriptionText
    ) {
      const definition = getItemDefinition(item.id);
      if (definition) {
        this.descriptionTitle.textContent = definition.name;
        let descText = definition.description;

        // Add stats for weapons/tools
        if (isWeapon(definition)) {
          descText += `\n\nType: ${definition.type}`;
          descText += `\nDamage: ${definition.damage}`;
          descText += `\nEquip Slot: ${definition.equipSlot}`;
        }
        // Add stats for consumables
        else if (isConsumable(definition)) {
          descText += `\n\nType: ${definition.type}`;
          if (definition.healAmount) {
            descText += `\nHeals: ${definition.healAmount} HP`;
          }
          // Add other consumable effects here
        }
        // Add stack info
        if (definition.stackable) {
          descText += `\nStack Size: ${definition.maxStack}`;
        } else {
          descText += `\nNot Stackable`;
        }

        this.descriptionText.textContent = descText;
        this.descriptionPanel.classList.remove("hidden");
      } else {
        // If definition not found, hide the panel
        this.hideItemDescription();
      }
    } else {
      // If no item in slot, hide the panel
      this.hideItemDescription();
    }
  }

  hideItemDescription(): void {
    if (this.descriptionPanel) {
      this.descriptionPanel.classList.add("hidden");
    }
    // Do not reset selectedItemIndex here, only when clicking elsewhere, closing, or taking action
  }

  toggle(): void {
    this.isOpen ? this.hide() : this.show();
  }

  show(): void {
    if (!this.displayElement || this.isOpen) return;
    this.isOpen = true;
    this.updateDisplay(this.inventory.items); // Update display immediately
    this.displayElement.classList.remove("hidden");
    this.game.setPauseState(true);
    // Don't automatically hide description when opening inventory
    // Don't reset selection on show, allow remembering last selection if desired
  }

  hide(): void {
    if (!this.displayElement || !this.isOpen) return;
    this.isOpen = false;
    this.displayElement.classList.add("hidden");
    this.hideItemDescription(); // Hide description when closing inventory
    this.selectedItemIndex = null; // Reset selection when closing
    this.game.setPauseState(false); // Unpause game when inventory closes
  }

  // Clean up listeners when the display is no longer needed
  destroy(): void {
    if (this.slotsContainer && this.boundHandleSlotClick) {
      this.slotsContainer.removeEventListener(
        "click",
        this.boundHandleSlotClick
      );
    }
    // Unregister inventory listener
    if (this.inventory && this.boundUpdateDisplay) {
      this.inventory.onChangeCallbacks =
        this.inventory.onChangeCallbacks.filter(
          (cb) => cb !== this.boundUpdateDisplay
        );
    }
    // Nullify references to prevent memory leaks
    this.inventory = null!;
    this.game = null!;
    this.displayElement = null;
    this.slotsContainer = null;
    this.descriptionPanel = null;
    this.descriptionTitle = null;
    this.descriptionText = null;
    this.selectedItemIndex = null;
  }
}
