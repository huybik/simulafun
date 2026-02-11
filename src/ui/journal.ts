/* File: /src/ui/journal.ts */
import { EventLog, EventEntry, Quest, QuestObjective } from "../core/utils";
import { Game } from "../main";

export class JournalDisplay {
  eventLog: EventLog;
  game: Game;
  displayElement: HTMLElement | null;
  eventListElement: HTMLElement | null;
  questListElement: HTMLElement | null;
  isOpen: boolean = false;
  boundUpdateEvents: (entries: EventEntry[]) => void;
  boundUpdateQuests: () => void;

  constructor(eventLog: EventLog, game: Game) {
    this.eventLog = eventLog;
    this.game = game;
    this.displayElement = document.getElementById("journal-display");
    this.eventListElement = document.getElementById("event-log");
    this.questListElement = document.getElementById("quest-log");
    this.boundUpdateEvents = this.updateEvents.bind(this);
    this.boundUpdateQuests = this.updateQuests.bind(this);
    this.eventLog.onChange(this.boundUpdateEvents);
    if (this.displayElement) this.displayElement.classList.add("hidden");

    const closeBtn = this.displayElement?.querySelector(".menu-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.hide());
    }
  }

  updateQuests(): void {
    if (!this.isOpen || !this.questListElement) return;
    this.questListElement.innerHTML = ""; // Clear previous entries

    if (
      !this.game?.questManager?.quests ||
      this.game.questManager.quests.length === 0
    ) {
      const li = document.createElement("li");
      li.textContent = "No active quests.";
      li.style.fontStyle = "italic";
      this.questListElement.appendChild(li);
      return;
    }

    this.game.questManager.quests.forEach((quest) => {
      const questContainer = document.createElement("li");
      questContainer.classList.add("quest-item-container");
      if (quest.isCompleted) {
        questContainer.classList.add("quest-completed");
      }
      questContainer.dataset.questId = quest.id; // Add ID for click handling
      questContainer.addEventListener("click", () => this.onQuestClick(quest)); // Add click listener to container

      const questTitle = document.createElement("div");
      questTitle.textContent = `${quest.name} ${quest.isCompleted ? "(Completed)" : ""}`;
      questTitle.classList.add("quest-title");

      const objectivesList = document.createElement("ul");
      objectivesList.classList.add("quest-objectives-list");

      quest.objectives.forEach((obj) => {
        const objLi = document.createElement("li");
        objLi.classList.add("quest-objective");
        if (obj.isCompleted) {
          objLi.classList.add("objective-completed");
        }
        // Format objective progress
        let progressText = "";
        if (obj.requiredCount > 1) {
          progressText = ` (${obj.currentCount} / ${obj.requiredCount})`;
        } else if (obj.requiredCount === 1) {
          progressText = obj.isCompleted ? " (Done)" : " (Pending)";
        }
        objLi.textContent = `- ${obj.description}${progressText}`;
        objectivesList.appendChild(objLi);
      });

      questContainer.appendChild(questTitle);
      questContainer.appendChild(objectivesList);
      this.questListElement?.appendChild(questContainer);
    });
  }

  onQuestClick(quest: Quest): void {
    // Use UIManager to show the banner
    if (this.game?.uiManager && quest) {
      // this.hide(); // Optionally hide journal when showing banner
      this.game.uiManager.showQuestCompletionBanner(quest);
    }
  }

  setEventLog(newEventLog: EventLog): void {
    if (this.eventLog === newEventLog) return;
    if (this.eventLog) {
      this.eventLog.onChangeCallbacks = this.eventLog.onChangeCallbacks.filter(
        (cb) => cb !== this.boundUpdateEvents
      );
    }
    this.eventLog = newEventLog;
    this.eventLog.onChange(this.boundUpdateEvents);
    if (this.isOpen) this.updateEvents(this.eventLog.entries);
  }

  updateEvents(entries: EventEntry[]): void {
    if (!this.isOpen || !this.eventListElement) return;
    this.eventListElement.innerHTML =
      entries.length === 0 ? "<li>No events recorded yet.</li>" : "";
    // Display latest events first
    [...entries].reverse().forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = `[${entry.timestamp}] ${entry.message}`;
      this.eventListElement!.appendChild(li);
    });
    // No auto-scroll needed if showing latest first
    // this.eventListElement.scrollTop = 0;
  }

  toggle(): void {
    this.isOpen ? this.hide() : this.show();
  }

  show(): void {
    if (!this.displayElement || this.isOpen) return;
    this.isOpen = true;
    this.updateEvents(this.eventLog.entries);
    this.updateQuests(); // Update quests when showing
    this.displayElement.classList.remove("hidden");
    this.game.setPauseState(true);
  }

  hide(): void {
    if (!this.displayElement || !this.isOpen) return;
    this.isOpen = false;
    this.displayElement.classList.add("hidden");
    this.game.setPauseState(false);
  }
}
