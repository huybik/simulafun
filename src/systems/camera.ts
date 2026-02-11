/* File: /src/systems/camera.ts */
// File: /src/systems/camera.ts
import {
  PerspectiveCamera,
  Object3D,
  Vector3,
  Raycaster,
  MathUtils,
} from "three";
import { smoothVectorLerp, getTerrainHeight } from "../core/utils";
import { Game } from "../main"; // Import Game

export class ThirdPersonCamera {
  camera: PerspectiveCamera;
  target: Object3D;
  game: Game; // Add reference to the Game instance
  // Use mobile values as the single standard
  idealOffset = new Vector3(0, 6, -6); // Further away and higher
  minOffsetDistance: number = 1.5;
  maxOffsetDistance: number = 12.0;
  pitchAngle: number; // Initialized in constructor
  minPitch: number = -Math.PI / 3;
  maxPitch: number = Math.PI / 2.5;
  pitchSensitivity: number = 0.0025;
  lerpAlphaPositionBase: number = 0.05;
  lerpAlphaLookatBase: number = 0.1;
  collisionRaycaster: Raycaster;
  collisionOffset: number = 0.3;
  currentPosition: Vector3;
  currentLookat: Vector3;

  // Horizon stabilization properties
  private targetPitchAngle: number = -0.4; // More top-down pitch
  private lastUserPitchInputTime: number = 0;
  private readonly pitchReturnTimeout: number = 3.0; // seconds
  private readonly pitchReturnSpeed: number = 0.02; // Lerp factor base for return
  private readonly userPitchInputThreshold: number = 0.0005; // Minimum deltaY to count as input
  private readonly terrainSlopeAdjustmentFactor: number = 0.3; // How much slope affects pitch (0 to 1)
  private readonly slopeSampleDistance: number = 1.0; // Distance ahead to sample terrain for slope

  // Conversation framing
  private conversationTarget: Object3D | null = null;
  private conversationTargetPos = new Vector3();

  private targetPosition = new Vector3();
  private offset = new Vector3();
  private idealPosition = new Vector3();
  private finalPosition = new Vector3();
  private idealLookat = new Vector3();
  private rayOrigin = new Vector3();
  private cameraDirection = new Vector3();
  private playerForward = new Vector3(); // To store player forward direction

  constructor(
    camera: PerspectiveCamera,
    target: Object3D,
    game: Game // Accept Game instance
  ) {
    this.camera = camera;
    this.target = target;
    this.game = game; // Store Game instance

    // Initialize pitch to the target pitch
    this.pitchAngle = this.targetPitchAngle;

    this.collisionRaycaster = new Raycaster();
    this.collisionRaycaster.camera = camera;
    this.currentPosition = new Vector3();
    this.currentLookat = new Vector3();
    this.target.getWorldPosition(this.currentLookat);
    this.currentLookat.y += (target.userData?.height ?? 1.8) * 0.6;
    this.lastUserPitchInputTime = performance.now() / 1000; // Initialize timestamp
    this.update(0.016, []); // Initial update to set position
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookat);
  }

  handleMouseInput(deltaX: number, deltaY: number): void {}

  setConversationTarget(target: Object3D | null): void {
    this.conversationTarget = target;
  }

  update(deltaTime: number, collidables: Object3D[]): void {
    if (!this.target || !this.target.parent || !this.game.scene) return;

    this.target.getWorldPosition(this.targetPosition);
    this.target.getWorldDirection(this.playerForward); // Get player's forward direction

    // --- Calculate Slope-Adjusted Target Pitch ---
    const h1 = getTerrainHeight(
      this.game.scene,
      this.targetPosition.x,
      this.targetPosition.z
    );
    const aheadPos = this.targetPosition
      .clone()
      .addScaledVector(this.playerForward, this.slopeSampleDistance);
    const h2 = getTerrainHeight(this.game.scene, aheadPos.x, aheadPos.z);
    const slopeAngle = Math.atan((h2 - h1) / this.slopeSampleDistance);

    // Use the single target pitch angle
    const baseTargetPitch = this.targetPitchAngle;

    // Adjust target pitch based on slope (subtract slope angle)
    const adjustedTargetPitch =
      baseTargetPitch - slopeAngle * this.terrainSlopeAdjustmentFactor;

    // --- Horizon Stabilization Logic ---
    // Always stabilize pitch towards the adjusted target pitch
    const returnFactor =
      1.0 - Math.pow(1.0 - this.pitchReturnSpeed, deltaTime * 60); // Adjust speed based on deltaTime
    this.pitchAngle = MathUtils.lerp(
      this.pitchAngle,
      adjustedTargetPitch, // Use the slope-adjusted target pitch
      returnFactor
    );
    // Ensure it doesn't overshoot due to lerp
    if (Math.abs(this.pitchAngle - adjustedTargetPitch) < 0.001) {
      this.pitchAngle = adjustedTargetPitch;
    }
    // Clamp pitch after stabilization
    this.pitchAngle = MathUtils.clamp(
      this.pitchAngle,
      this.minPitch,
      this.maxPitch
    );
    // --- End Horizon Stabilization Logic ---

    const targetQuaternion = this.target.quaternion;

    // Use the single ideal offset
    const currentIdealOffset = this.idealOffset;

    // Calculate ideal camera position based on current pitch and target orientation
    this.offset
      .copy(currentIdealOffset) // Use the standard offset
      .applyAxisAngle(new Vector3(1, 0, 0), this.pitchAngle) // Apply potentially stabilized pitch
      .applyQuaternion(targetQuaternion);
    this.idealPosition.copy(this.targetPosition).add(this.offset);

    // Collision detection and adjustment
    this.cameraDirection.copy(this.idealPosition).sub(this.targetPosition);
    let idealDistance = this.cameraDirection.length();
    this.cameraDirection.normalize();
    this.rayOrigin
      .copy(this.targetPosition)
      .addScaledVector(this.cameraDirection, 0.2); // Start ray slightly ahead of target
    this.collisionRaycaster.set(this.rayOrigin, this.cameraDirection);
    this.collisionRaycaster.far = Math.max(0, idealDistance - 0.2); // Ray length up to ideal position

    const collisionCheckObjects = collidables.filter(
      (obj) => obj !== this.target && obj?.userData?.isCollidable
    );
    const intersects = this.collisionRaycaster.intersectObjects(
      collisionCheckObjects,
      true
    );

    let actualDistance = idealDistance;
    if (intersects.length > 0) {
      // Find the closest intersection point
      actualDistance =
        intersects.reduce(
          (minDist, intersect) => Math.min(minDist, intersect.distance),
          idealDistance
        ) +
        0.2 - // Add back the initial offset
        this.collisionOffset; // Subtract collision buffer
      actualDistance = Math.max(this.minOffsetDistance, actualDistance); // Clamp to min distance
    }

    // Clamp final distance
    actualDistance = MathUtils.clamp(
      actualDistance,
      this.minOffsetDistance,
      this.maxOffsetDistance
    );

    // Calculate final camera position
    this.finalPosition
      .copy(this.targetPosition)
      .addScaledVector(this.cameraDirection, actualDistance);

    // Calculate ideal lookat point (slightly above target center)
    const targetHeight = this.target.userData?.height ?? 1.8;
    this.idealLookat
      .copy(this.targetPosition)
      .add(new Vector3(0, targetHeight * 0.6, 0));

    // Shift lookat toward conversation target for framing both characters
    if (this.conversationTarget && this.conversationTarget.parent) {
      this.conversationTarget.getWorldPosition(this.conversationTargetPos);
      this.conversationTargetPos.y += targetHeight * 0.6;
      this.idealLookat.lerp(this.conversationTargetPos, 0.4);
    }

    // Smoothly interpolate current position and lookat towards their targets
    smoothVectorLerp(
      this.currentPosition,
      this.finalPosition,
      this.lerpAlphaPositionBase,
      deltaTime
    );
    smoothVectorLerp(
      this.currentLookat,
      this.idealLookat,
      this.lerpAlphaLookatBase,
      deltaTime
    );

    // Apply final position and lookat to the camera
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookat);
  }
}
