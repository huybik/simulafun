/* File: /src/core/environment.ts */
import {
  Scene,
  Vector3,
  Object3D,
  Group,
  AnimationClip,
  Mesh,
  Box3,
} from "three";
import { Character } from "../entities/character";
import { Animal } from "../entities/animals";
import {
  createTree,
  createRock,
  createHerb,
  createGrassPatch,
  createFlowerPatch,
} from "../models/objects";
import { getTerrainHeight, randomFloat, Inventory } from "./utils";
import { Game } from "../main";
import {
  Profession,
  ProfessionStartingWeapon,
  getItemDefinition,
  isWeapon,
} from "./items";

function collectTemplates(
  models: Record<string, { scene: Group; animations: AnimationClip[] }>,
  ...prefixes: string[]
): Group[] {
  return Object.entries(models)
    .filter(([key]) => prefixes.some((p) => key.startsWith(p)))
    .map(([, m]) => m.scene)
    .filter(Boolean);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function populateEnvironment(
  scene: Scene,
  worldSize: number,
  collidableObjects: Object3D[],
  interactableObjects: Array<any>,
  entities: Array<any>,
  inventory: Inventory,
  models: Record<string, { scene: Group; animations: AnimationClip[] }>,
  gameInstance: Game
): void {
  const halfSize = worldSize / 2;
  const villageCenter = new Vector3(5, 0, 10);
  const villageRadiusSq = 15 * 15;

  const terrain = scene.getObjectByName("Terrain") as Mesh;
  if (!terrain) {
    console.error("Terrain not found in scene!");
    return;
  }

  // Collect environment templates from loaded models
  const treeTemplates = collectTemplates(models, "env_tree_", "env_pine_");
  const rockTemplates = collectTemplates(models, "env_rock_");
  const herbTemplates = collectTemplates(models, "env_bush_", "env_herb_");
  const grassTemplates = collectTemplates(models, "env_grass_");
  const flowerTemplates = collectTemplates(models, "env_flower_");

  const addCharacter = (
    pos: Vector3,
    name: string,
    modelKey: string,
    profession: Profession,
    isPlayer: boolean = false
  ): Character => {
    const model = models[modelKey];
    const charInventory = new Inventory(9);
    const character = new Character(
      scene,
      pos,
      name,
      model.scene,
      model.animations,
      charInventory
    );
    character.mesh!.position.y = getTerrainHeight(scene, pos.x, pos.z);
    character.homePosition = character.mesh!.position.clone();
    character.game = gameInstance;
    character.profession = profession;

    if (isPlayer) {
      character.name = "Player";
      character.userData.isPlayer = true;
      character.userData.isNPC = false;
      if (character.aiController) character.aiController = null;
    } else {
      character.userData.isPlayer = false;
      character.userData.isNPC = true;
      if (!character.aiController)
        console.warn(`NPC ${name} created without AIController!`);
      else {
        character.aiController.homePosition = character.homePosition.clone();
      }

      const startingWeaponId = ProfessionStartingWeapon[profession];
      if (startingWeaponId) {
        const addResult = character.inventory?.addItem(startingWeaponId, 1);
        if (addResult && addResult.totalAdded > 0) {
          const weaponDef = getItemDefinition(startingWeaponId);
          if (weaponDef && isWeapon(weaponDef)) {
            requestAnimationFrame(() => {
              character.equipWeapon(weaponDef);
            });
            console.log(
              `Gave starting weapon ${weaponDef.name} to NPC ${character.name} (${profession})`
            );
          }
        } else {
          console.warn(
            `Could not give starting weapon ${startingWeaponId} to NPC ${character.name} (inventory full?).`
          );
        }
      }
    }
    character.inventory?.addItem("coin", 10);

    entities.push(character);
    collidableObjects.push(character.mesh!);
    interactableObjects.push(character);
    return character;
  };

  // Add NPCs with professions
  const farmerGiles = addCharacter(
    villageCenter.clone().add(new Vector3(-12, 0, 2)),
    "Farmer Giles",
    "tavernMan",
    Profession.Farmer
  );
  farmerGiles.persona =
    "A hardworking farmer who values community and is always willing to help others. He is knowledgeable about crops and livestock but can be a bit stubborn. He prefers to stay close to his farm but will venture out if necessary.";
  if (farmerGiles.aiController)
    farmerGiles.aiController.persona = farmerGiles.persona;

  const blacksmithBrynn = addCharacter(
    villageCenter.clone().add(new Vector3(10, 0, -3)),
    "Blacksmith Brynn",
    "woman",
    Profession.Blacksmith
  );
  blacksmithBrynn.persona =
    "A skilled artisan who takes pride in her work. She is strong-willed and independent, often focused on her craft. She can be gruff but has a kind heart, especially towards those in need.";
  if (blacksmithBrynn.aiController)
    blacksmithBrynn.aiController.persona = blacksmithBrynn.persona;

  const hunterRex = addCharacter(
    new Vector3(halfSize * 0.4, 0, -halfSize * 0.3),
    "Hunter Rex",
    "oldMan",
    Profession.Hunter
  );
  hunterRex.persona =
    "An experienced tracker and survivalist. He is quiet and observant, preferring the wilderness over the village. He is resourceful and can be relied upon in tough situations but is not very social.";
  if (hunterRex.aiController)
    hunterRex.aiController.persona = hunterRex.persona;

  // Add Objects (Trees, Rocks, Herbs)
  const addObject = (
    creator: (pos: Vector3) => Group,
    count: number,
    minDistSq: number
  ) => {
    for (let i = 0; i < count; i++) {
      const x = randomFloat(-halfSize * 0.95, halfSize * 0.95);
      const z = randomFloat(-halfSize * 0.95, halfSize * 0.95);
      const distSq = (x - villageCenter.x) ** 2 + (z - villageCenter.z) ** 2;
      if (distSq < minDistSq) continue;

      const obj = creator(new Vector3(x, 0, z));
      const height = getTerrainHeight(scene, x, z);
      obj.position.y = height;

      scene.add(obj);
      if (obj.userData.isCollidable) collidableObjects.push(obj);
      if (obj.userData.isInteractable) interactableObjects.push(obj);
      entities.push(obj);
      obj.userData.id = `${obj.name}_${obj.uuid.substring(0, 6)}`;

      obj.updateMatrixWorld(true);
      if (obj.userData.boundingBox instanceof Box3) {
        obj.userData.boundingBox.setFromObject(obj, true);
      }
    }
  };

  if (treeTemplates.length > 0) {
    addObject(
      (pos) => createTree(pos, pickRandom(treeTemplates)),
      worldSize,
      25 * 25
    );
  }
  if (rockTemplates.length > 0) {
    addObject(
      (pos) => createRock(pos, randomFloat(1, 2.5), pickRandom(rockTemplates)),
      Math.floor(worldSize / 2),
      20 * 20
    );
  }
  if (herbTemplates.length > 0) {
    addObject(
      (pos) => createHerb(pos, pickRandom(herbTemplates)),
      Math.floor(worldSize / 5),
      10 * 10
    );
  }

  // Add Animals
  const addAnimal = (
    animalType: string,
    modelKey: string,
    count: number,
    minDistSq: number
  ) => {
    const model = models[modelKey];
    if (!model) {
      console.warn(
        `Model key "${modelKey}" not found for animal ${animalType}`
      );
      return;
    }
    for (let i = 0; i < count; i++) {
      const x = randomFloat(-halfSize * 0.9, halfSize * 0.9);
      const z = randomFloat(-halfSize * 0.9, halfSize * 0.9);
      const distSq = (x - villageCenter.x) ** 2 + (z - villageCenter.z) ** 2;
      if (distSq < minDistSq) continue;

      const pos = new Vector3(x, 0, z);
      pos.y = getTerrainHeight(scene, x, z);

      const animal = new Animal(
        scene,
        pos,
        `${animalType} ${i + 1}`,
        animalType,
        model.scene.clone(),
        model.animations
      );
      animal.game = gameInstance;

      entities.push(animal);
      collidableObjects.push(animal.mesh!);
      interactableObjects.push(animal);
    }
  };

  addAnimal("Deer", "deer_procedural", 5, 20 * 20);
  addAnimal("Wolf", "wolf_procedural", 5, 40 * 40);

  // Add Decorative Grass and Flowers
  const addDecoration = (
    creator: (pos: Vector3, terrain: Mesh) => Group,
    count: number,
    minDistSq: number
  ) => {
    for (let i = 0; i < count; i++) {
      const x = randomFloat(-halfSize * 0.95, halfSize * 0.95);
      const z = randomFloat(-halfSize * 0.95, halfSize * 0.95);
      const distSq = (x - villageCenter.x) ** 2 + (z - villageCenter.z) ** 2;
      if (distSq < minDistSq) continue;

      const decoration = creator(new Vector3(x, 0, z), terrain);
      const height = getTerrainHeight(scene, x, z);
      decoration.position.y = height;

      scene.add(decoration);
    }
  };

  if (grassTemplates.length > 0) {
    addDecoration(
      (pos, t) => createGrassPatch(pos, t, grassTemplates),
      Math.floor(worldSize * 0.8),
      villageRadiusSq
    );
  }

  if (flowerTemplates.length > 0) {
    addDecoration(
      (pos, t) => createFlowerPatch(pos, t, flowerTemplates),
      Math.floor(worldSize * 0.15),
      villageRadiusSq
    );
  }
}
