/* File: /src/components/equipmentUtils.ts */
import { Character } from "../entities/character";
import { WeaponDefinition, EquippedItem } from "../core/items";
import { Vector3, Quaternion } from "three";

// Helper quaternions for weapon orientation (shared instance)
const _charWorldQuat = new Quaternion();
const _handWorldQuat = new Quaternion();
const _targetLocalQuat = new Quaternion();
// Assumes weapon models point along +Z, rotate 180 deg around Y to face -Z (character forward)
const _weaponRotationOffset = new Quaternion().setFromAxisAngle(
  new Vector3(0, 0, 0), // Rotate around Y axis
  Math.PI // 180 degrees
);

/**
 * Equips a weapon or tool to the character's hand.
 * @param character The character entity.
 * @param definition The definition of the weapon/tool to equip.
 */
export function equipWeapon(
  character: Character,
  definition: WeaponDefinition
): void {
  if (
    character.isDead ||
    !character.rightHandBone ||
    !character.game ||
    !character.mesh
  ) {
    console.warn(
      `Cannot equip ${definition.name}: Character dead, no right hand bone, game not linked, or mesh missing.`
    );
    return;
  }

  const modelKey = definition.modelFileName;
  const weaponModelData = character.game.models[modelKey];

  if (!weaponModelData?.scene) {
    console.error(
      `Weapon model data for ${definition.name} (key: ${modelKey}) not found or invalid in preloaded models. Cannot equip.`
    );
    character.game.logEvent(
      character,
      "equip_fail",
      `Failed to equip ${definition.name} (model not loaded).`,
      undefined,
      { item: definition.name },
      character.mesh.position
    );
    return;
  }

  unequipWeapon(character); // Unequip previous weapon first

  try {
    const weaponModel = weaponModelData.scene.clone();

    weaponModel.position.set(0, 0, 0);
    weaponModel.rotation.set(0, 0, 0);
    weaponModel.scale.set(1, 1, 1);

    // Compensate for the bone's accumulated world scale so the weapon
    // appears at a consistent size regardless of character model scaling.
    const boneWorldScale = new Vector3();
    character.rightHandBone!.getWorldScale(boneWorldScale);
    const invBoneScale = new Vector3(
      boneWorldScale.x === 0 ? 1 : 1 / boneWorldScale.x,
      boneWorldScale.y === 0 ? 1 : 1 / boneWorldScale.y,
      boneWorldScale.z === 0 ? 1 : 1 / boneWorldScale.z
    );
    weaponModel.scale.copy(invBoneScale);

    // Per-weapon scale and position tuning (values are in world-space units)
    if (definition.id === "sword") {
      weaponModel.scale.multiplyScalar(0.2);
      weaponModel.position.set(0, 0.2, 0);
    } else if (definition.id === "axe") {
      weaponModel.scale.multiplyScalar(0.2);
      weaponModel.position.set(0, 0.25, 0);
    } else if (definition.id === "pickaxe") {
      weaponModel.scale.multiplyScalar(0.07);
      weaponModel.position.set(0, 0.1, 0);
    } else {
      weaponModel.scale.multiplyScalar(0.2);
    }

    character.rightHandBone.add(weaponModel);
    weaponModel.rotation.set(0, 0, 0); // Reset local rotation after attaching

    character.equippedWeapon = {
      definition: definition,
      modelInstance: weaponModel,
      attachedBone: character.rightHandBone,
    };

    console.log(`${character.name} equipped ${definition.name}.`);
    character.game.logEvent(
      character,
      "equip",
      `Equipped ${definition.name}.`,
      undefined,
      { item: definition.name },
      character.mesh.position
    );
  } catch (error) {
    console.error(`Error during weapon attach ${definition.name}:`, error);
    character.game.logEvent(
      character,
      "equip_fail",
      `Failed to equip ${definition.name} (attach error).`,
      undefined,
      { item: definition.name, error: (error as Error).message },
      character.mesh.position
    );
  }
}

/**
 * Unequips the currently held weapon/tool from the character.
 * @param character The character entity.
 */
export function unequipWeapon(character: Character): void {
  if (character.equippedWeapon && character.rightHandBone) {
    character.rightHandBone.remove(character.equippedWeapon.modelInstance);
    console.log(
      `${character.name} unequipped ${character.equippedWeapon.definition.name}.`
    );
    if (character.game) {
      character.game.logEvent(
        character,
        "unequip",
        `Unequipped ${character.equippedWeapon.definition.name}.`,
        undefined,
        { item: character.equippedWeapon.definition.name },
        character.mesh!.position
      );
    }
  }
  character.equippedWeapon = null;
}

/**
 * Updates the orientation of the equipped weapon to align with the character's forward direction.
 * @param character The character entity.
 */
export function updateWeaponOrientation(character: Character): void {
  if (character.equippedWeapon && character.rightHandBone && character.mesh) {
    const weaponModel = character.equippedWeapon.modelInstance;
    const handBone = character.rightHandBone;

    character.mesh.getWorldQuaternion(_charWorldQuat);
    handBone.getWorldQuaternion(_handWorldQuat);

    _targetLocalQuat.copy(_handWorldQuat).invert().multiply(_charWorldQuat);

    // Apply offset if weapon model points along +Z instead of -Z (character forward)
    _targetLocalQuat.multiply(_weaponRotationOffset); // Re-enable if models point +Z

    weaponModel.quaternion.copy(_targetLocalQuat);
  }
}
