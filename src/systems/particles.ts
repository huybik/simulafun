// File: /src/systems/particles.ts
import * as THREE from "three";
import { Game } from "../main";

export function spawnParticleEffect(
  game: Game,
  position: THREE.Vector3,
  colorName: "red" | "green"
): void {
  if (!game.scene || !game.clock) return;
  const particleCount = 15;
  const particleSize = 0.08;
  const effectDuration = 1.2;
  const spreadRadius = 0.4;
  const particleSpeed = 2.0;

  const baseColor = colorName === "red" ? 0xff4444 : 0x44ff66;
  const glowColor = colorName === "red" ? 0xff8888 : 0x88ffaa;

  const effectGroup = new THREE.Group();
  effectGroup.position.copy(position);
  const geometry = new THREE.SphereGeometry(particleSize, 6, 4);

  for (let i = 0; i < particleCount; i++) {
    // Alternate between base and glow colors for sparkle effect
    const color = Math.random() > 0.5 ? baseColor : glowColor;
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 1.0,
    });
    const particle = new THREE.Mesh(geometry, material);
    const initialOffset = new THREE.Vector3(
      (Math.random() - 0.5) * spreadRadius,
      Math.random() * spreadRadius * 0.5, // bias upward
      (Math.random() - 0.5) * spreadRadius
    );
    particle.position.copy(initialOffset);

    // Particles move outward and upward
    const velocity = initialOffset
      .clone()
      .normalize()
      .multiplyScalar(particleSpeed * (0.4 + Math.random() * 0.6));
    velocity.y += particleSpeed * 0.5; // upward drift
    particle.userData.velocity = velocity;

    // Random scale variation
    const scale = 0.5 + Math.random() * 1.0;
    particle.scale.setScalar(scale);

    effectGroup.add(particle);
  }

  effectGroup.userData.startTime = game.clock.elapsedTime;
  effectGroup.userData.duration = effectDuration;
  game.scene.add(effectGroup);
  game.particleEffects.push(effectGroup);
}

export function updateParticleEffects(game: Game, elapsedTime: number): void {
  if (!game.scene || !game.clock) return;
  const effectsToRemove: THREE.Group[] = [];
  const particleDeltaTime = game.isPaused ? 0 : game.clock.getDelta();

  for (let i = game.particleEffects.length - 1; i >= 0; i--) {
    const effect = game.particleEffects[i];
    const effectElapsedTime = elapsedTime - effect.userData.startTime;
    const progress = Math.min(
      1.0,
      effectElapsedTime / effect.userData.duration
    );

    if (progress >= 1.0) {
      effectsToRemove.push(effect);
      game.particleEffects.splice(i, 1);
      continue;
    }

    if (!game.isPaused) {
      effect.children.forEach((particle) => {
        if (particle instanceof THREE.Mesh && particle.userData.velocity) {
          particle.position.addScaledVector(
            particle.userData.velocity,
            particleDeltaTime
          );
          // Slow down over time
          particle.userData.velocity.multiplyScalar(0.96);
          // Shrink particles as they fade
          const scale = (1.0 - progress) * particle.scale.x;
          particle.scale.setScalar(Math.max(0.01, scale));
        }
      });
    }

    // Fade out using eased progress
    const easedProgress = progress * progress; // Quadratic ease-out
    effect.children.forEach((particle) => {
      if (particle instanceof THREE.Mesh) {
        if (Array.isArray(particle.material)) {
          particle.material.forEach((mat) => {
            if (mat instanceof THREE.MeshBasicMaterial) {
              mat.opacity = 1.0 - easedProgress;
              mat.needsUpdate = true;
            }
          });
        } else if (particle.material instanceof THREE.MeshBasicMaterial) {
          particle.material.opacity = 1.0 - easedProgress;
          particle.material.needsUpdate = true;
        }
      }
    });
  }

  effectsToRemove.forEach((effect) => {
    effect.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material))
          child.material.forEach((mat) => mat.dispose());
        else child.material?.dispose();
      }
    });
    game.scene!.remove(effect);
  });
}
