/* File: src/models/objects.ts */
import {
  Vector3,
  Mesh,
  Group,
  CylinderGeometry,
  ConeGeometry,
  BoxGeometry,
  SphereGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  Box3,
  Color,
  MathUtils,
  DoubleSide,
  Raycaster,
  Quaternion,
  AnimationMixer,
  LoopOnce,
  InstancedMesh,
  Object3D,
  Matrix4,
} from "three";
import { Character } from "../entities/character";
import { Inventory, InteractionResult, randomFloat } from "../core/utils";
import { Colors } from "../core/constants";
import { createTreeFallAnimation } from "../core/animations";

// Upgraded materials from Lambert to Standard for better lighting response
const treeTrunkMat = new MeshStandardMaterial({
  color: 0xa0724a,
  roughness: 0.9,
  metalness: 0.0,
});
const treeFoliageMats = [
  new MeshStandardMaterial({
    color: 0x5a9e3c,
    roughness: 0.8,
    metalness: 0.0,
  }),
  new MeshStandardMaterial({
    color: 0x4a8e2c,
    roughness: 0.8,
    metalness: 0.0,
  }),
  new MeshStandardMaterial({
    color: 0x6aae4c,
    roughness: 0.8,
    metalness: 0.0,
  }),
];
const rockMats = [
  new MeshStandardMaterial({
    color: 0x8a9aaa,
    roughness: 0.85,
    metalness: 0.05,
  }),
  new MeshStandardMaterial({
    color: 0x7a8a9a,
    roughness: 0.9,
    metalness: 0.05,
  }),
  new MeshStandardMaterial({
    color: 0x9aaabb,
    roughness: 0.8,
    metalness: 0.05,
  }),
];
const herbMat = new MeshStandardMaterial({
  color: 0x3d8b37,
  roughness: 0.7,
  metalness: 0.0,
  emissive: 0x0a2a08,
  emissiveIntensity: 0.2,
});

// Base health values for resources
const BASE_HEALTH = {
  wood: 100,
  stone: 150,
  herb: 30,
};

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

export function createTree(position: Vector3): Group {
  const trunkHeight = randomFloat(3, 5);
  const trunkRadius = randomFloat(0.3, 0.5);
  const foliageHeight = trunkHeight * 1.2 + randomFloat(0, 1);
  const foliageRadius = trunkRadius * 3 + randomFloat(0, 1.5);
  const treeGroup = new Group();
  treeGroup.name = "Tree";

  // Trunk with slight taper
  const trunkGeo = new CylinderGeometry(
    trunkRadius * 0.7,
    trunkRadius,
    trunkHeight,
    8
  );
  const trunkMesh = new Mesh(trunkGeo, treeTrunkMat);
  trunkMesh.name = "TreeTrunk";
  trunkMesh.position.y = trunkHeight / 2;
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  treeGroup.add(trunkMesh);

  // Foliage - pick random variation for natural look
  const foliageMat =
    treeFoliageMats[Math.floor(Math.random() * treeFoliageMats.length)];

  // Main foliage cone
  const foliageGeo = new ConeGeometry(foliageRadius, foliageHeight, 6);
  const foliageMesh = new Mesh(foliageGeo, foliageMat);
  foliageMesh.position.y = trunkHeight + foliageHeight / 3;
  foliageMesh.castShadow = true;
  treeGroup.add(foliageMesh);

  // Second smaller cone on top for layered look
  const topFoliageRadius = foliageRadius * 0.65;
  const topFoliageHeight = foliageHeight * 0.7;
  const topFoliageGeo = new ConeGeometry(topFoliageRadius, topFoliageHeight, 6);
  const topFoliageMesh = new Mesh(topFoliageGeo, foliageMat);
  topFoliageMesh.position.y =
    trunkHeight + foliageHeight * 0.5 + topFoliageHeight / 3;
  topFoliageMesh.castShadow = true;
  treeGroup.add(topFoliageMesh);

  // Slight random rotation for variety
  treeGroup.rotation.y = Math.random() * Math.PI * 2;

  treeGroup.position.copy(position).setY(0);
  const maxHealth = BASE_HEALTH.wood;

  const trunkBox = new Box3();
  trunkMesh.updateWorldMatrix(true, false);
  trunkBox.setFromObject(trunkMesh);

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
    boundingBox: trunkBox,
    mixer: mixer,
    fallAction: fallAction,
    isFalling: false,
  };

  return treeGroup;
}

export function createRock(position: Vector3, size: number): Group {
  const rockGroup = new Group();
  rockGroup.name = "Rock";
  const height = size * randomFloat(2, 3);

  // Pick random rock material for variation
  const rockMat = rockMats[Math.floor(Math.random() * rockMats.length)];

  const geo = new BoxGeometry(size, height, size * randomFloat(0.8, 1.2));
  const mesh = new Mesh(geo, rockMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.rotation.set(
    randomFloat(-0.1, 0.1) * Math.PI,
    randomFloat(0, 2) * Math.PI,
    randomFloat(-0.1, 0.1) * Math.PI
  );
  rockGroup.add(mesh);

  // Add a smaller rock nearby for a more natural cluster
  if (Math.random() > 0.4) {
    const smallSize = size * randomFloat(0.3, 0.5);
    const smallGeo = new BoxGeometry(
      smallSize,
      smallSize * randomFloat(1, 2),
      smallSize
    );
    const smallMesh = new Mesh(smallGeo, rockMat);
    smallMesh.castShadow = true;
    smallMesh.receiveShadow = true;
    smallMesh.position.set(
      randomFloat(-size, size) * 0.8,
      0,
      randomFloat(-size, size) * 0.8
    );
    smallMesh.rotation.set(
      randomFloat(-0.2, 0.2),
      randomFloat(0, Math.PI * 2),
      randomFloat(-0.2, 0.2)
    );
    rockGroup.add(smallMesh);
  }

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
  rockGroup.userData.boundingBox.setFromObject(rockGroup);
  return rockGroup;
}

export function createHerb(position: Vector3): Group {
  const herbGroup = new Group();
  herbGroup.name = "Herb Plant";
  const size = 1;
  const geo = new SphereGeometry(size, 10, 20);
  const mesh = new Mesh(geo, herbMat);
  mesh.castShadow = true;
  herbGroup.add(mesh);
  herbGroup.position.copy(position).setY(size);
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
  herbGroup.userData.boundingBox.setFromObject(herbGroup);
  return herbGroup;
}

// --- Decorative Elements ---

// Optimized grass using InstancedMesh for massive draw call reduction
export function createGrassPatch(position: Vector3, terrain: Mesh): Group {
  const patchGroup = new Group();
  patchGroup.name = "Grass Patch";
  const bladeCount = MathUtils.randInt(80, 200);
  const patchRadius = 5;

  const bladeGeo = new PlaneGeometry(0.04, 0.6);
  // Shift geometry so blade grows upward from base
  bladeGeo.translate(0, 0.3, 0);

  const grassColors = [0x4a7a2e, 0x5a8a3e, 0x3a6a1e, 0x6a9a4e];
  const grassMat = new MeshBasicMaterial({
    color: grassColors[Math.floor(Math.random() * grassColors.length)],
    side: DoubleSide,
  });

  const instancedGrass = new InstancedMesh(bladeGeo, grassMat, bladeCount);
  instancedGrass.frustumCulled = true;

  const dummy = new Object3D();
  for (let i = 0; i < bladeCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * patchRadius;
    dummy.position.set(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius
    );
    const bladeHeight = randomFloat(0.4, 1.2);
    dummy.scale.set(1, bladeHeight, 1);
    dummy.rotation.set(
      randomFloat(-0.15, 0.15),
      Math.random() * Math.PI * 2,
      randomFloat(-0.15, 0.15)
    );
    dummy.updateMatrix();
    instancedGrass.setMatrixAt(i, dummy.matrix);
  }
  instancedGrass.instanceMatrix.needsUpdate = true;
  patchGroup.add(instancedGrass);

  // Place on terrain
  const raycaster = new Raycaster();
  raycaster.set(
    new Vector3(position.x, 100, position.z),
    new Vector3(0, -1, 0)
  );
  const intersects = raycaster.intersectObject(terrain);
  if (intersects.length > 0) {
    const intersect = intersects[0];
    patchGroup.position.copy(intersect.point);
    const normal = intersect.normal
      ? intersect.normal.clone()
      : new Vector3(0, 1, 0);
    const up = new Vector3(0, 1, 0);
    const quaternion = new Quaternion().setFromUnitVectors(up, normal);
    patchGroup.setRotationFromQuaternion(quaternion);
  } else {
    patchGroup.position.copy(position);
  }

  patchGroup.userData = { isDecoration: true };
  return patchGroup;
}

const flowerColors = [0xff6b8a, 0xffd93d, 0xb47de8, 0xff8c42, 0xff4d6d, 0x48c9b0];

function createFlower(colorHex: number): Group {
  const flowerGroup = new Group();
  const stemHeight = randomFloat(0.15, 0.8);
  const stemRadius = 0.015;
  const petalSize = randomFloat(0.04, 0.07);
  const petalCount = MathUtils.randInt(4, 7);

  // Stem
  const stemGeo = new CylinderGeometry(stemRadius, stemRadius, stemHeight, 4);
  const stemMat = new MeshBasicMaterial({ color: 0x2d6b1e });
  const stemMesh = new Mesh(stemGeo, stemMat);
  stemMesh.position.y = stemHeight / 2;
  flowerGroup.add(stemMesh);

  // Petals
  const petalMat = new MeshBasicMaterial({
    color: colorHex,
    side: DoubleSide,
  });
  const petalGeo = new PlaneGeometry(petalSize, petalSize);
  for (let i = 0; i < petalCount; i++) {
    const petalMesh = new Mesh(petalGeo, petalMat);
    const angle = (i / petalCount) * Math.PI * 2;
    const petalRadius = petalSize * 0.7;

    petalMesh.position.set(
      Math.cos(angle) * petalRadius,
      stemHeight + petalSize * 0.2,
      Math.sin(angle) * petalRadius
    );
    petalMesh.rotation.y = angle + Math.PI / 2;
    petalMesh.rotation.x = Math.PI / 4;

    flowerGroup.add(petalMesh);
  }

  // Flower center
  const centerGeo = new SphereGeometry(petalSize * 0.3, 4, 4);
  const centerMat = new MeshBasicMaterial({ color: 0xfff176 });
  const centerMesh = new Mesh(centerGeo, centerMat);
  centerMesh.position.y = stemHeight + petalSize * 0.15;
  flowerGroup.add(centerMesh);

  return flowerGroup;
}

export function createFlowerPatch(position: Vector3, terrain: Mesh): Group {
  const patchGroup = new Group();
  patchGroup.name = "Flower Patch";
  const flowerCount = MathUtils.randInt(20, 50);
  const patchRadius = 4;

  for (let i = 0; i < flowerCount; i++) {
    const randomColor =
      flowerColors[MathUtils.randInt(0, flowerColors.length - 1)];
    const flower = createFlower(randomColor);

    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * patchRadius;
    flower.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    flower.rotation.y = Math.random() * Math.PI * 2;

    patchGroup.add(flower);
  }

  const raycaster = new Raycaster();
  raycaster.set(
    new Vector3(position.x, 100, position.z),
    new Vector3(0, -1, 0)
  );
  const intersects = raycaster.intersectObject(terrain);
  if (intersects.length > 0) {
    const intersect = intersects[0];
    patchGroup.position.copy(intersect.point);
    const normal = intersect.normal
      ? intersect.normal.clone()
      : new Vector3(0, 1, 0);
    const up = new Vector3(0, 1, 0);
    const quaternion = new Quaternion().setFromUnitVectors(up, normal);
    patchGroup.setRotationFromQuaternion(quaternion);
  } else {
    patchGroup.position.copy(position);
  }

  patchGroup.userData = { isDecoration: true };
  return patchGroup;
}
