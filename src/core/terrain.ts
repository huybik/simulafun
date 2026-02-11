// File: /src/core/terrain.ts
import {
  Mesh,
  PlaneGeometry,
  MeshStandardMaterial,
  MathUtils,
  Color,
  Float32BufferAttribute,
} from "three";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";
import { smoothstep } from "./utils";

export function createTerrain(size: number, segments: number = 150): Mesh {
  const simplexTerrain = new SimplexNoise();
  const simplexDetail = new SimplexNoise();
  const geometry = new PlaneGeometry(size, size, segments, segments);
  const vertices = geometry.attributes.position.array as Float32Array;
  const numVertices = geometry.attributes.position.count;
  const noiseStrength = 16;
  const noiseScale = 0.005;
  const detailNoiseScale = 0.02;
  const detailNoiseStrength = 2;
  const flattenRadius = 240;
  const flattenStrength = 0.1;

  // Height values for coloring
  const heights: number[] = [];

  for (let i = 0; i < numVertices; i++) {
    const index = i * 3;
    const x = vertices[index];
    const y = vertices[index + 1];

    // Multi-octave noise for more natural terrain
    let z =
      simplexTerrain.noise(x * noiseScale, y * noiseScale) * noiseStrength;
    z +=
      simplexDetail.noise(x * detailNoiseScale, y * detailNoiseScale) *
      detailNoiseStrength;

    const distanceToCenter = Math.sqrt(x * x + y * y);
    if (distanceToCenter < flattenRadius) {
      const flattenFactor =
        1.0 - smoothstep(0, flattenRadius, distanceToCenter);
      z = MathUtils.lerp(z, z * (1.0 - flattenStrength), flattenFactor);
    }
    vertices[index + 2] = z;
    heights.push(z);
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  // Vertex coloring based on height and slope
  const colors = new Float32Array(numVertices * 3);
  const normals = geometry.attributes.normal.array as Float32Array;

  // Color palette
  const valleyColor = new Color(0x5a8c3c); // Rich dark green
  const grassColor = new Color(0x7ab648); // Vibrant green
  const hillColor = new Color(0x9aba5e); // Light yellow-green
  const peakColor = new Color(0xb8a67a); // Sandy/earthy
  const pathColor = new Color(0x8a7d5a); // Dirt-like for flat areas

  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  const heightRange = maxH - minH || 1;

  for (let i = 0; i < numVertices; i++) {
    const h = (heights[i] - minH) / heightRange; // normalize 0-1

    // Get slope from normal (y component after rotation = up direction)
    const ny = normals[i * 3 + 1]; // y-normal (up)
    const slope = 1.0 - Math.abs(ny); // 0 = flat, 1 = vertical

    // Blend colors based on height
    const color = new Color();
    if (h < 0.3) {
      color.lerpColors(valleyColor, grassColor, h / 0.3);
    } else if (h < 0.6) {
      color.lerpColors(grassColor, hillColor, (h - 0.3) / 0.3);
    } else {
      color.lerpColors(hillColor, peakColor, (h - 0.6) / 0.4);
    }

    // Mix in path/dirt color on flatter areas near center
    const distToCenter = Math.sqrt(
      vertices[i * 3] * vertices[i * 3] +
        vertices[i * 3 + 2] * vertices[i * 3 + 2]
    );
    if (distToCenter < 20 && slope < 0.1) {
      const pathBlend = (1 - distToCenter / 20) * 0.3;
      color.lerp(pathColor, pathBlend);
    }

    // Add slight variation for natural look
    const variation = (Math.random() - 0.5) * 0.03;
    color.r = MathUtils.clamp(color.r + variation, 0, 1);
    color.g = MathUtils.clamp(color.g + variation, 0, 1);
    color.b = MathUtils.clamp(color.b + variation, 0, 1);

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));

  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
    flatShading: false,
  });

  const terrainMesh = new Mesh(geometry, material);
  terrainMesh.receiveShadow = true;
  terrainMesh.name = "Terrain";
  terrainMesh.userData = {
    isTerrain: true,
    isCollidable: true,
    worldSize: size,
    segments,
  };
  return terrainMesh;
}
