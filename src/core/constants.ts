// File: /src/core/constants.ts
export const WORLD_SIZE = 100;
export const TERRAIN_SEGMENTS = 60;

export const CHARACTER_HEIGHT = 1.8;
export const CHARACTER_RADIUS = 0.4;

export const Colors = {
  PASTEL_GREEN: 0x98fb98,
  PASTEL_BROWN: 0xcd853f,
  PASTEL_GRAY: 0xb0c4de,
  FOREST_GREEN: 0x228b22,
} as const;

export const DEFAULT_INVENTORY_SIZE = 20;
export const ITEM_MAX_STACK = {
  default: 64,
  wood: 99,
  stone: 99,
  herb: 30,
  feather: 50,
  "Health Potion": 10,
  gold: Infinity,
} as const;

export const INTERACTION_DISTANCE = 3.0;
export const AIM_TOLERANCE = Math.PI / 6;

export const PORTAL_RADIUS = 2;
export const PORTAL_TUBE = 0.2;
export const PORTAL_PARTICLE_COUNT = 1000;

// --- AI / API Config ---
export const GEMINI_MODEL = "gemini-flash-latest";
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const AI_CONFIG = {
  apiCallCooldown: 30000,
  affectedCooldown: 15000,
  actionTimerBase: 5,
  actionTimerVariance: 5,
  chatDecisionDelay: 7000,
  interactionDistance: 3,
  attackDistance: 2,
  followDistance: 5,
  stoppingDistance: 3,
} as const;

export const ANIMAL_AI_CONFIG = {
  actionTimer: 5,
  attackCooldown: 2.0,
  attackRange: 1.5,
  detectionRange: 15.0,
  roamRadius: 20.0,
} as const;

// --- Game Loop Config ---
export const GAME_LOOP = {
  aiUpdateInterval: 0.2,
  questCheckInterval: 0.5,
  targetFPS: 42,
} as const;
