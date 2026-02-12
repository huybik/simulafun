/* File: src/models/objects.ts */
import {
  Vector3,
  Mesh,
  Group,
  Scene,
  Box3,
  MathUtils,
  Raycaster,
  AnimationMixer,
  LoopOnce,
  Color,
  MeshStandardMaterial,
} from "three";
import { Character } from "../entities/character";
import { InteractionResult, randomFloat } from "../core/utils";
import { createTreeFallAnimation } from "../core/animations";

// Base health values for resources
const BASE_HEALTH = {
  wood: 100,
  stone: 150,
  herb: 30,
};

function enableShadows(obj: Group) {
  obj.traverse((child) => {
    if ((child as Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

export class InteractableObject {
  id: string;
  name: string;
  position: Vector3;
  interactionType: string;
  data: any;
  prompt: string;
  mesh: Mesh | Group | null;
  isActive: boolean;
  userData: any;

  constructor(
    id: string,
    name: string,
    position: Vector3,
    interactionType: string,
    data: any,
    prompt: string,
    scene: Scene | null = null
  ) {
    this.id = id;
    this.name = name;
    this.position = position.clone();
    this.interactionType = interactionType;
    this.data = data;
    this.prompt = prompt;
    this.mesh = null;
    this.isActive = true;
    this.userData = {
      id: this.id,
      entityReference: this,
      isInteractable: true,
      interactionType: this.interactionType,
      prompt: this.prompt,
      data: this.data,
      isSimpleObject: true,
      isEntity: false,
      isPlayer: false,
      isNPC: false,
      isCollidable: true,
    };
  }

  interact(player: Character): InteractionResult | null {
    if (!this.isActive) return { type: "error", message: "Already used." };
    let message = "";
    let action = "interact";
    let details: Record<string, any> = {};
    const inventory = player.inventory;
    const game = player.game;
    if (!inventory || !game)
      return { type: "error", message: "Internal error." };
    switch (this.interactionType) {
      case "retrieve":
        const itemName = this.data as string;
        if (inventory.addItem(itemName, 1)) {
          message = `Picked up: ${itemName}`;
          action = "retrieve";
          details = { item: itemName, amount: 1 };
          this.removeFromWorld();
          game.logEvent(
            player,
            action,
            message,
            this.name,
            details,
            this.position
          );
          return {
            type: "item_retrieved",
            item: { name: itemName, amount: 1 },
          };
        } else {
          message = `Inventory is full. Cannot pick up ${itemName}.`;
          action = "retrieve_fail";
          details = { item: itemName };
          game.logEvent(
            player,
            action,
            message,
            this.name,
            details,
            this.position
          );
          return { type: "error", message: "Inventory full" };
        }
      default:
        message = `${player.name} looked at ${this.name}.`;
        action = "examine";
        game.logEvent(
          player,
          action,
          message,
          this.name,
          details,
          this.position
        );
        return { type: "message", message: "You look at the object." };
    }
  }

  removeFromWorld(): void {
    this.isActive = false;
    this.userData.isInteractable = false;
    if (this.mesh) {
      this.mesh.visible = false;
      this.userData.isCollidable = false;
    }
  }
}

export function createTree(position: Vector3, template: Group): Group {
  const treeGroup = template.clone();
  treeGroup.name = "Tree";
  treeGroup.rotation.y = Math.random() * Math.PI * 2;
  const scale = randomFloat(0.8, 1.3);
  treeGroup.scale.setScalar(scale);
  enableShadows(treeGroup);
  treeGroup.position.copy(position).setY(0);

  const maxHealth = BASE_HEALTH.wood;
  const mixer = new AnimationMixer(treeGroup);
  const fallClip = createTreeFallAnimation(treeGroup, 1.5);
  const fallAction = mixer.clipAction(fallClip);
  fallAction.setLoop(LoopOnce, 1);
  fallAction.clampWhenFinished = true;

  treeGroup.userData = {
    isCollidable: true,
    isInteractable: true,
    interactionType: "attack",
    resource: "wood",
    health: maxHealth,
    maxHealth: maxHealth,
    isDepletable: true,
    respawnTime: 20000,
    entityReference: treeGroup,
    boundingBox: new Box3().setFromObject(treeGroup),
    mixer,
    fallAction,
    isFalling: false,
  };

  return treeGroup;
}

export function createRock(
  position: Vector3,
  size: number,
  template: Group
): Group {
  const rockGroup = template.clone();
  rockGroup.name = "Rock";
  rockGroup.rotation.y = Math.random() * Math.PI * 2;
  const scale = size * randomFloat(0.6, 1.0);
  rockGroup.scale.setScalar(scale);
  enableShadows(rockGroup);
  rockGroup.position.copy(position).setY(0);

  const maxHealth = BASE_HEALTH.stone;
  rockGroup.userData = {
    isCollidable: true,
    isInteractable: true,
    interactionType: "attack",
    resource: "stone",
    health: maxHealth,
    maxHealth: maxHealth,
    isDepletable: true,
    respawnTime: 30000,
    entityReference: rockGroup,
    boundingBox: new Box3().setFromObject(rockGroup),
  };

  return rockGroup;
}

export function createHerb(position: Vector3, template: Group): Group {
  const herbGroup = template.clone();
  herbGroup.name = "Herb Plant";
  herbGroup.rotation.y = Math.random() * Math.PI * 2;
  const scale = randomFloat(0.8, 1.2);
  herbGroup.scale.setScalar(scale);
  enableShadows(herbGroup);
  herbGroup.position.copy(position).setY(0);

  // Add a subtle glow to distinguish harvestable herbs
  herbGroup.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      const mat = (mesh.material as MeshStandardMaterial);
      if (mat.isMeshStandardMaterial) {
        mesh.material = mat.clone();
        (mesh.material as MeshStandardMaterial).emissive = new Color(0x2a6e1e);
        (mesh.material as MeshStandardMaterial).emissiveIntensity = 0.35;
      }
    }
  });

  const maxHealth = BASE_HEALTH.herb;
  herbGroup.userData = {
    isCollidable: true,
    isInteractable: true,
    interactionType: "attack",
    resource: "herb",
    health: maxHealth,
    maxHealth: maxHealth,
    isDepletable: true,
    respawnTime: 15000,
    entityReference: herbGroup,
    boundingBox: new Box3().setFromObject(herbGroup),
  };

  return herbGroup;
}

// --- Decorative Elements ---

export function createGrassPatch(
  position: Vector3,
  terrain: Mesh,
  templates: Group[]
): Group {
  const patchGroup = new Group();
  patchGroup.name = "Grass Patch";
  const count = MathUtils.randInt(25, 45);
  const patchRadius = 6;

  for (let i = 0; i < count; i++) {
    const template = templates[Math.floor(Math.random() * templates.length)];
    const clone = template.clone();
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * patchRadius;
    clone.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    clone.rotation.y = Math.random() * Math.PI * 2;
    clone.scale.setScalar(randomFloat(0.6, 1.4));
    patchGroup.add(clone);
  }

  const raycaster = new Raycaster();
  raycaster.set(
    new Vector3(position.x, 100, position.z),
    new Vector3(0, -1, 0)
  );
  const intersects = raycaster.intersectObject(terrain);
  if (intersects.length > 0) {
    patchGroup.position.copy(intersects[0].point);
  } else {
    patchGroup.position.copy(position);
  }

  patchGroup.userData = { isDecoration: true };
  return patchGroup;
}

export function createFlowerPatch(
  position: Vector3,
  terrain: Mesh,
  templates: Group[]
): Group {
  const patchGroup = new Group();
  patchGroup.name = "Flower Patch";
  const count = MathUtils.randInt(5, 12);
  const patchRadius = 4;

  for (let i = 0; i < count; i++) {
    const template = templates[Math.floor(Math.random() * templates.length)];
    const clone = template.clone();
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * patchRadius;
    clone.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    clone.rotation.y = Math.random() * Math.PI * 2;
    clone.scale.setScalar(randomFloat(0.7, 1.3));
    patchGroup.add(clone);
  }

  const raycaster = new Raycaster();
  raycaster.set(
    new Vector3(position.x, 100, position.z),
    new Vector3(0, -1, 0)
  );
  const intersects = raycaster.intersectObject(terrain);
  if (intersects.length > 0) {
    patchGroup.position.copy(intersects[0].point);
  } else {
    patchGroup.position.copy(position);
  }

  patchGroup.userData = { isDecoration: true };
  return patchGroup;
}
