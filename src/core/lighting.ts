// File: /src/core/lighting.ts
import {
  Scene,
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  Color,
} from "three";

export function setupLighting(scene: Scene): DirectionalLight {
  // Warm ambient light for overall fill
  const ambientLight = new AmbientLight(0xc9dae8, 0.5);
  scene.add(ambientLight);

  // Main directional light (warm golden sun)
  const directionalLight = new DirectionalLight(0xffecd2, 1.2);
  directionalLight.position.set(80, 160, 60);
  directionalLight.castShadow = true;
  directionalLight.target.position.set(0, 0, 0);

  // High-quality shadow settings
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 1;
  directionalLight.shadow.camera.far = 400;
  const shadowCamSize = 40;
  directionalLight.shadow.camera.left = -shadowCamSize;
  directionalLight.shadow.camera.right = shadowCamSize;
  directionalLight.shadow.camera.top = shadowCamSize;
  directionalLight.shadow.camera.bottom = -shadowCamSize;
  directionalLight.shadow.bias = -0.0003;
  directionalLight.shadow.normalBias = 0.02;
  scene.add(directionalLight);
  scene.add(directionalLight.target);

  // Store reference for dynamic shadow tracking
  scene.userData.directionalLight = directionalLight;

  // Hemisphere light: warm sky above, cool green ground bounce
  const hemisphereLight = new HemisphereLight(
    new Color(0x87ceeb), // sky blue above
    new Color(0x4a7c3f), // earthy green below
    0.4
  );
  scene.add(hemisphereLight);

  return directionalLight;
}
