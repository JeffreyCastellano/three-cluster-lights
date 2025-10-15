// @three-cluster-lights - Main library entry point
// High-performance WebAssembly-powered clustered lighting system for Three.js

// Core clustered lighting system
export {
  ClusterLightingSystem,
  // Light type constants
  LightType,
  // Animation type constants
  Animation,
  LinearMode,
  PulseTarget,
  RotateMode,
  // LOD levels
  LODLevel
} from './core/cluster-lighting-system.js';

// Cluster-specific GLSL shaders
export {
  lights_physical_pars_fragment,
  lights_fragment_begin,
  lights_fragment_begin_optimized,
  ShaderVariants,
  getListMaterial,
  getMasterMaterial
} from './core/cluster-shaders.js';

// Performance monitoring
export {
  GPUQuery,
  FPSMeter,
  CPUTimer,
  MemoryMonitor
} from './performance/performance-metrics.js';

// Visual light markers
export { LightMarkers } from './visual/light-markers.js';

// WASM loader helper (includes ASM.js fallback)
export { loadWasm } from './utils/wasm-loader.js';

// Unified Performance Tracker (easiest to use)
export { PerformanceTracker } from './performance/performance-tracker.js';

// Adaptive performance tuning
export { AdaptiveTileSpan } from './performance/adaptive-tile-span.js';

/**
 * @three-cluster-lights
 *
 * A high-performance clustered lighting system for Three.js powered by WebAssembly.
 *
 * Features:
 * - Support for 32,000+ dynamic lights
 * - Point, Spot, and Rect (area) lights
 * - Rich animation system (circular, wave, flicker, pulse, rotation)
 * - Automatic LOD (Level of Detail) for performance
 * - WebAssembly acceleration with SIMD support
 * - GPU-based light clustering
 *
 * @example
 * ```javascript
 * import { ClusterLightingSystem, LightType, Animation } from 'three-cluster-lights';
 * import { Vector3, Color } from 'three';
 *
 * // Load WASM module
 * const wasm = await WebAssembly.instantiateStreaming(
 *   fetch('/cluster-lights-simd.wasm'),
 *   { env: { emscripten_notify_memory_growth: () => {} } }
 * );
 *
 * // Create lighting system
 * const lights = new ClusterLightingSystem(
 *   renderer,
 *   wasm,
 *   0.1,    // near plane
 *   1000,   // far plane
 *   32, 16, 32, // cluster resolution (x, y, z)
 *   true    // performance mode
 * );
 *
 * // Add a light
 * lights.addLight({
 *   type: LightType.POINT,
 *   position: new Vector3(0, 5, 0),
 *   color: new Color(1, 0, 0),
 *   intensity: 10,
 *   radius: 15,
 *   animation: {
 *     circular: { speed: 1, radius: 5 }
 *   }
 * });
 *
 * // Patch materials to use clustered lighting
 * lights.patchMaterial(yourMaterial);
 *
 * // In render loop
 * function animate() {
 *   const time = clock.getElapsedTime();
 *   lights.update(time, camera);
 *   renderer.render(scene, camera);
 * }
 * ```
 */
