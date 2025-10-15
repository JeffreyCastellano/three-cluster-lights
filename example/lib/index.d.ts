// Type definitions for three-cluster-lights
// Project: three-cluster-lights
// Definitions by: three-cluster-lights contributors

import * as THREE from 'three';

// ============================================================================
// Core Types
// ============================================================================

export enum LightType {
  POINT = 0,
  SPOT = 1,
  RECT = 2
}

export enum Animation {
  NONE = 0x00,
  CIRCULAR = 0x01,
  LINEAR = 0x02,
  WAVE = 0x04,
  FLICKER = 0x08,
  PULSE = 0x10,
  ROTATE = 0x20
}

export enum LinearMode {
  ONCE = 0,
  LOOP = 1,
  PINGPONG = 2
}

export enum PulseTarget {
  INTENSITY = 0x01,
  RADIUS = 0x02,
  BOTH = 0x03
}

export enum RotateMode {
  CONTINUOUS = 0,
  SWING = 1
}

export enum LODLevel {
  SKIP = 0,
  SIMPLE = 1,
  MEDIUM = 2,
  FULL = 3
}

// ============================================================================
// Light Configuration Interfaces
// ============================================================================

export interface CircularAnimation {
  speed?: number;
  radius?: number;
}

export interface LinearAnimation {
  to?: THREE.Vector3 | [number, number, number];
  target?: THREE.Vector3 | [number, number, number];
  duration?: number;
  delay?: number;
  mode?: 'once' | 'loop' | 'pingpong' | LinearMode;
}

export interface WaveAnimation {
  axis?: THREE.Vector3 | [number, number, number];
  speed?: number;
  amplitude?: number;
  phase?: number;
}

export interface FlickerAnimation {
  speed?: number;
  intensity?: number;
  seed?: number;
}

export interface PulseAnimation {
  speed?: number;
  amount?: number;
  target?: 'intensity' | 'radius' | 'both' | PulseTarget;
}

export interface RotationAnimation {
  axis?: THREE.Vector3 | [number, number, number];
  speed?: number;
  angle?: number;
  mode?: 'continuous' | 'swing' | RotateMode;
}

export interface LightAnimation {
  circular?: CircularAnimation;
  linear?: LinearAnimation;
  wave?: WaveAnimation;
  flicker?: FlickerAnimation;
  pulse?: PulseAnimation;
  rotation?: RotationAnimation;
  rotate?: RotationAnimation;
}

export interface BaseLightConfig {
  position: THREE.Vector3;
  color: THREE.Color;
  intensity?: number;
  radius?: number;
  decay?: number;
  visible?: boolean;
  animation?: LightAnimation;
}

export interface PointLightConfig extends BaseLightConfig {
  type?: 'point';
}

export interface SpotLightConfig extends BaseLightConfig {
  type: 'spot';
  direction?: THREE.Vector3;
  angle?: number;
  penumbra?: number;
}

export interface RectLightConfig extends BaseLightConfig {
  type: 'rect';
  width?: number;
  height?: number;
  normal?: THREE.Vector3;
}

export type LightConfig = PointLightConfig | SpotLightConfig | RectLightConfig;

// ============================================================================
// Cluster Lighting System
// ============================================================================

export class ClusterLightingSystem {
  constructor(
    renderer: THREE.WebGLRenderer,
    wasm: WebAssembly.WebAssemblyInstantiatedSource,
    near: number,
    far: number,
    sliceX: number,
    sliceY: number,
    sliceZ: number,
    performanceMode?: boolean
  );

  // Properties
  near: number;
  far: number;
  readonly maxSafeLights: number;
  readonly pointLightCount: number;
  readonly spotLightCount: number;
  readonly rectLightCount: number;

  // Material patching
  patchMaterial(material: THREE.Material): void;

  // Light management
  addLight(light: LightConfig): number;
  removeLight(globalIndex: number): void;
  clearLights(): void;

  // Light updates
  updateLightPosition(globalIndex: number, position: THREE.Vector3): void;
  updateLightColor(globalIndex: number, color: THREE.Color): void;
  updateLightIntensity(globalIndex: number, intensity: number): void;
  updateLightRadius(globalIndex: number, radius: number): void;
  updateLightDecay(globalIndex: number, decay: number): void;
  updateLightVisibility(globalIndex: number, visible: boolean): void;
  updateLightAnimation(globalIndex: number, animation: LightAnimation): void;

  // Spot light specific updates
  updateSpotDirection(globalIndex: number, direction: THREE.Vector3): void;
  updateSpotAngle(globalIndex: number, angle: number, penumbra: number): void;

  // Rect light specific updates
  updateRectSize(globalIndex: number, width: number, height: number): void;
  updateRectNormal(globalIndex: number, normal: THREE.Vector3): void;

  // Bulk operations
  bulkConfigPointLights(lights: PointLightConfig[], append?: boolean): void;
  bulkConfigLights(lights: LightConfig[], shuffle?: boolean): void;
  bulkUpdateLights(updates: Array<{ index: number; properties: Partial<LightConfig> }>): void;
  finalizeProgressiveLoading(): void;

  // LOD control
  setLODBias(bias: number): void;
  getLODBias(): number;
  getLightLOD(globalIndex: number): number;

  // Performance tuning
  setMaxTileSpan(span: number): void;
  getMaxTileSpan(): number;
  setDynamicClusters(enable: boolean): void;
  setZeroCopyMode(enabled: boolean): void;
  setDeferredSorting(enabled: boolean): void;
  sortNow(): void;
  forceClusterUpdate(): void;

  // Main update
  update(time: number, camera: THREE.Camera, scene?: THREE.Scene): void;
  resize(): void;

  // Import/Export
  exportLights(): LightConfig[];
  importLights(lightData: LightConfig[]): void;

  // Cleanup
  dispose(): void;
}

// ============================================================================
// Shader Utilities
// ============================================================================

export const lights_physical_pars_fragment: string;
export const lights_fragment_begin: string;
export const lights_fragment_begin_optimized: string;

export interface ShaderVariant {
  condition: (lights: {
    pointCount: number;
    spotCount: number;
    rectCount: number;
    totalCount: number;
    hasSimpleAnimations: boolean;
    hasComplexAnimations: boolean;
    hasMixedTypes: boolean;
  }) => boolean;
  fragment: string;
}

export const ShaderVariants: {
  ULTRA_OPTIMIZED: ShaderVariant;
  OPTIMIZED: ShaderVariant;
  FULL_FEATURED: ShaderVariant;
};

export function getListMaterial(): THREE.RawShaderMaterial;
export function getMasterMaterial(): THREE.RawShaderMaterial;

// ============================================================================
// Performance Monitoring
// ============================================================================

export class GPUQuery {
  constructor(renderer: THREE.WebGLRenderer, selector: string);
  start(): void;
  end(time: number): void;
  dispose(): void;
}

export class FPSMeter {
  constructor(selector: string, minSelector: string, maxSelector: string);
  update(time: number): void;
}

export class CPUTimer {
  constructor(selector: string);
  begin(): void;
  end(time: number): void;
}

export class MemoryMonitor {
  constructor(selector: string, unitSelector: string);
  update(time: number): void;
}

export interface PerformanceTrackerOptions {
  container?: HTMLElement;
  showFPS?: boolean;
  showCPU?: boolean;
  showGPU?: boolean;
  showMemory?: boolean;
  showWASM?: boolean;
  showCluster?: boolean;
  showRender?: boolean;
}

export class PerformanceTracker {
  constructor(renderer: THREE.WebGLRenderer, options?: PerformanceTrackerOptions);
  begin(): void;
  end(): void;
  beginCluster(): void;
  endCluster(): void;
  beginRender(): void;
  endRender(): void;
  setWASMTime(ms: number): void;
  dispose(): void;
  getTrackers(): {
    fps?: FPSMeter;
    cpu?: CPUTimer;
    memory?: MemoryMonitor;
    cluster?: GPUQuery;
    render?: GPUQuery;
  };
}

export interface AdaptiveTileSpanOptions {
  targetFPS?: number;
  minTileSpan?: number;
  maxTileSpan?: number;
  enabled?: boolean;
  adjustmentRate?: number;
  updateInterval?: number;
  fpsMarginLow?: number;
  fpsMarginHigh?: number;
}

export class AdaptiveTileSpan {
  constructor(lightsSystem: ClusterLightingSystem, options?: AdaptiveTileSpanOptions);
  update(deltaTime: number): void;
  setEnabled(enabled: boolean): void;
  setTargetFPS(fps: number): void;
  reset(): void;
  getStats(): {
    enabled: boolean;
    currentFPS: number;
    averageFPS: number;
    targetFPS: number;
    currentTileSpan: number;
    minTileSpan: number;
    maxTileSpan: number;
  };
}

// ============================================================================
// Visual Debugging
// ============================================================================

export interface LightMarkersOptions {
  visible?: boolean;
  showGlow?: boolean;
  pointGlowRadius?: number;
  spotGlowRadius?: number;
  rectGlowRadius?: number;
  glowRadius?: number;
  colorOverride?: THREE.Vector3;
  markerScale?: number;
}

export class LightMarkers {
  constructor(lightsSystem: ClusterLightingSystem, options?: LightMarkersOptions);
  init(scene: THREE.Scene): void;
  update(scene: THREE.Scene): void;
  setVisible(visible: boolean): void;
  setShowGlow(show: boolean): void;
  setGlowRadius(radius: number): void;
  setColorOverride(color: THREE.Vector3 | null): void;
  setMarkerScale(scale: number): void;
  reinit(scene: THREE.Scene): void;
  dispose(scene: THREE.Scene): void;
}

// ============================================================================
// WASM Loader
// ============================================================================

export interface WasmLoadOptions {
  preferSIMD?: boolean;
  wasmPath?: string;
  allowFallback?: boolean;
}

export function loadWasm(options?: WasmLoadOptions): Promise<WebAssembly.WebAssemblyInstantiatedSource>;

