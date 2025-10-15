# three-cluster-lights - Library Components

This directory contains the core library files for the three-cluster-lights system - a high-performance WebAssembly-powered clustered lighting solution for Three.js.

## 🔗 Links

- **[Interactive Documentation](https://jeffreycastellano.github.io/three-cluster-lights/)** - Storybook with live examples
- **[Live Example App](https://three-cluster-lights.netlify.app)** - Full-featured demo
- **[NPM Package](https://www.npmjs.com/package/three-cluster-lights)** - Install via `npm install three-cluster-lights`
- **[GitHub Repository](https://github.com/jeffreycastellano/three-cluster-lights)** - Source code

## 📁 Library Structure

```
lib/
├── index.js              # Main entry point - exports all public APIs
├── index.d.ts            # TypeScript definitions
├── package.json          # NPM package configuration
├── README.md             # This file
│
├── core/                 # Core lighting system
│   ├── cluster-lighting-system.js  # Main ClusterLightingSystem class
│   └── cluster-shaders.js          # GLSL shaders and materials
│
├── performance/          # Performance monitoring and optimization
│   ├── performance-metrics.js      # Low-level metrics (GPUQuery, FPSMeter, etc.)
│   ├── performance-tracker.js      # Unified performance tracker
│   └── adaptive-tile-span.js       # Adaptive performance tuning
│
├── utils/                # Utilities
│   └── wasm-loader.js              # WASM loading with fallback
│
├── visual/               # Visual debugging
│   └── light-markers.js            # Visual light markers
│
└── wasm/                 # WebAssembly binaries
    ├── cluster-lights-simd.wasm    # SIMD-optimized version
    ├── cluster-lights.wasm         # Standard version
    ├── cluster-lights-asm.js       # JavaScript fallback
    └── cluster-lights.c            # Source code
```

## 📦 Installation & Usage

### Basic Import

```javascript
import {
  ClusterLightingSystem,
  LightMarkers,
  PerformanceTracker,
  loadWasm,
  LightType,
  Animation
} from 'three-cluster-lights';
```

### Subpath Imports

```javascript
// Import only what you need
import { ClusterLightingSystem } from 'three-cluster-lights/core';
import { PerformanceTracker } from 'three-cluster-lights/performance';
import { loadWasm } from 'three-cluster-lights/utils';
import { LightMarkers } from 'three-cluster-lights/visual';
```

## 🔧 Module Overview

### `core/` - Core Lighting System

#### `cluster-lighting-system.js`
Main clustered lighting system implementation. Manages light data, WASM integration, GPU clustering, and shader patching.

**Main Class:** `ClusterLightingSystem`

#### `cluster-shaders.js`
GLSL shader code specifically for clustered lighting. Includes material patching functions and shader variants.

**Exports:**
- `lights_physical_pars_fragment` - Shader preamble
- `lights_fragment_begin` - Full-featured fragment shader
- `lights_fragment_begin_optimized` - Optimized fragment shader
- `ShaderVariants` - Automatic shader variant selection
- `getListMaterial()` - Material for list visualization
- `getMasterMaterial()` - Material for master texture

### `performance/` - Performance Monitoring

#### `performance-metrics.js`
Low-level performance monitoring primitives for GPU timing, FPS tracking, CPU time, and memory usage.

**Classes:**
- `GPUQuery` - GPU timing using WebGL timer queries
- `FPSMeter` - Frames per second with min/max tracking
- `CPUTimer` - CPU frame time measurement
- `MemoryMonitor` - JavaScript heap memory tracking

#### `performance-tracker.js`
High-level unified performance tracker with automatic HTML/CSS injection.

**Class:** `PerformanceTracker`

#### `adaptive-tile-span.js`
Adaptive performance tuning that automatically adjusts rendering quality based on target FPS.

**Class:** `AdaptiveTileSpan`

### `visual/` - Visual Debugging

#### `light-markers.js`
Visual markers for displaying light positions in the scene with instanced rendering.

**Class:** `LightMarkers`

### `utils/` - Utilities

#### `wasm-loader.js`
Helper utility for loading WebAssembly modules with automatic SIMD detection and ASM.js fallback.

**Function:** `loadWasm(options)`

---

## 🔨 Building WebAssembly Modules

The library includes pre-compiled WASM binaries, but you can rebuild them if needed.

### Prerequisites

Install [Emscripten](https://emscripten.org/docs/getting_started/downloads.html):

```bash
# Install emsdk
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

### Build Commands

From the `lib/` directory:

```bash
# Build standard WASM (no SIMD)
npm run build:wasm

# Build SIMD-optimized WASM (requires SIMD support)
npm run build:wasm-simd

# Build ASM.js fallback (for environments without WebAssembly)
npm run build:asm

# Build all versions
npm run build:all
```

### Output Files

- `wasm/cluster-lights.wasm` - Standard WebAssembly module (~50KB)
- `wasm/cluster-lights-simd.wasm` - SIMD-optimized version (~55KB)
- `wasm/cluster-lights-asm.js` - JavaScript fallback (~200KB)

### What Gets Compiled

The WASM modules are compiled from `wasm/cluster-lights.c`, which implements:

- Light data structures and memory management
- Morton code sorting for spatial coherence
- Light animation updates (circular, wave, flicker, pulse, rotation)
- View-space transformations
- LOD (Level of Detail) calculations
- Bulk operations for performance

### Build Optimizations

The SIMD version includes:
- `-msimd128` - Enable 128-bit SIMD operations
- `-msse, -msse2, -msse3, -msse4.1` - Enable SSE instructions
- `--closure 1` - Google Closure Compiler optimizations
- `-flto` - Link-time optimization

---

## API Documentation

### ClusterLightingSystem

High-performance clustered lighting system powered by WebAssembly.

#### Constructor

```javascript
const lights = new ClusterLightingSystem(
  renderer,        // THREE.WebGLRenderer
  wasmModule,      // WebAssembly module instance
  near,            // Camera near plane
  far,             // Camera far plane
  sliceX,          // Cluster grid X resolution
  sliceY,          // Cluster grid Y resolution
  sliceZ,          // Cluster grid Z resolution
  performanceMode  // Optional: enable performance optimizations (default: true)
);
```

#### Public Methods

##### Light Management
```javascript
// Add a light (returns global light index)
const index = lights.addLight({
  type: LightType.POINT,  // or 'point', 'spot', 'rect'
  position: new THREE.Vector3(0, 5, 0),
  color: new THREE.Color(1, 0, 0),
  intensity: 10,
  radius: 15,
  decay: 2,
  visible: true,
  animation: {
    circular: { speed: 1, radius: 5 },
    pulse: { speed: 1, amount: 0.5, target: PulseTarget.INTENSITY }
  }
});

// Fast light addition (skips some checks for bulk operations)
lights.addFastLight(lightConfig);

// Remove a light
lights.removeLight(globalIndex);
```

##### Light Property Updates
```javascript
lights.updateLightPosition(globalIndex, position);
lights.updateLightColor(globalIndex, color);
lights.updateLightIntensity(globalIndex, intensity);
lights.updateLightRadius(globalIndex, radius);
lights.updateLightDecay(globalIndex, decay);
lights.updateLightVisibility(globalIndex, visible);
lights.updateLightAnimation(globalIndex, animationConfig);
```

##### Animation Shortcuts
```javascript
// Pulse animation
lights.updatePulseSpeed(globalIndex, speed);
lights.updatePulseAmount(globalIndex, amount);
lights.updatePulseMinMax(globalIndex, min, max);
lights.updatePulseTarget(globalIndex, PulseTarget.INTENSITY);

// Flicker animation
lights.updateFlickerAmount(globalIndex, amount);
lights.updateFlickerSpeed(globalIndex, speed);

// Circular animation
lights.updateCircularSpeed(globalIndex, speed);
lights.updateCircularRadius(globalIndex, radius);

// Rotation animation
lights.updateRotationSpeed(globalIndex, speed);
lights.updateRotationAngle(globalIndex, angle);
```

##### Material Integration
```javascript
// Patch a material to use clustered lighting
lights.patchMaterial(material);
```

##### Configuration
```javascript
// Enable/disable dynamic cluster resolution
lights.setDynamicClusters(enabled);

// Set LOD bias (affects quality/performance tradeoff)
lights.setLODBias(bias);
const bias = lights.getLODBias();
```

##### Main Loop
```javascript
// Call in your render loop
function animate() {
  const time = clock.getElapsedTime();
  lights.update(time, camera);
  renderer.render(scene, camera);
}
```

---

### LightMarkers

Visual markers for light positions using instanced rendering.

#### Constructor
```javascript
const markers = new LightMarkers(lightsSystem, {
  visible: true,
  showGlow: true,
  glowRadius: 0.5,
  pointGlowRadius: 0.5,
  spotGlowRadius: 0.5,
  rectGlowRadius: 0.5,
  colorOverride: null  // THREE.Vector3 or null
});
```

#### Public Methods
```javascript
markers.init(scene);           // Add markers to scene
markers.update(scene);         // Update marker positions
markers.dispose(scene);        // Remove and cleanup
markers.reinit(scene);         // Dispose and reinit

// Configuration
markers.setVisible(visible);
markers.setShowGlow(show);
markers.setGlowRadius(radius);
markers.setColorOverride(color);
```

---

### PerformanceTracker

All-in-one performance monitoring with automatic UI injection.

#### Constructor
```javascript
const tracker = new PerformanceTracker(renderer, {
  container: document.body,
  showFPS: true,
  showCPU: true,
  showGPU: true,
  showMemory: true,
  showWASM: true,
  showCluster: true,
  showRender: true
});
```

#### Public Methods
```javascript
tracker.begin();   // Call at start of render loop
tracker.end();     // Call at end of render loop
tracker.dispose(); // Cleanup
```

---

### Performance Metrics (Low-Level)

#### GPUQuery
```javascript
const query = new GPUQuery(renderer, "#element-id");
query.start();
// ... GPU work ...
query.end(time);
query.dispose();
```

#### FPSMeter
```javascript
const fps = new FPSMeter("#fps", "#minFps", "#maxFps");
fps.update(time);
```

#### CPUTimer
```javascript
const cpu = new CPUTimer("#cpu-value");
cpu.begin();
// ... work ...
cpu.end(time);
```

#### MemoryMonitor
```javascript
const mem = new MemoryMonitor("#mem-value", "#mem-unit");
mem.update(time);
```

---

### Constants

#### LightType
```javascript
LightType.POINT   // 0
LightType.SPOT    // 1
LightType.RECT    // 2
```

#### Animation (Bitwise Flags)
```javascript
Animation.NONE      // 0x00
Animation.CIRCULAR  // 0x01
Animation.LINEAR    // 0x02
Animation.WAVE      // 0x04
Animation.FLICKER   // 0x08
Animation.PULSE     // 0x10
Animation.ROTATE    // 0x20
```

#### LinearMode
```javascript
LinearMode.ONCE      // 0 - Play once
LinearMode.LOOP      // 1 - Loop continuously
LinearMode.PINGPONG  // 2 - Bounce back and forth
```

#### PulseTarget (Bitwise Flags)
```javascript
PulseTarget.INTENSITY  // 0x01
PulseTarget.RADIUS     // 0x02
PulseTarget.BOTH       // 0x03
```

#### RotateMode
```javascript
RotateMode.CONTINUOUS  // 0 - Continuous rotation
RotateMode.SWING       // 1 - Swing back and forth
```

#### LODLevel
```javascript
LODLevel.SKIP    // 0 - Don't render
LODLevel.SIMPLE  // 1 - Minimal quality
LODLevel.MEDIUM  // 2 - Medium quality
LODLevel.FULL    // 3 - Full quality
```

---

## CSS Files

### `performance-tracker.css`
Styles for the performance stats overlay.

**Usage in HTML:**
```html
<link rel="stylesheet" href="path/to/performance-tracker.css">
```

**Usage via npm:**
```javascript
import 'three-cluster-lights/styles/performance-tracker.css';
```

**Note:** When using `PerformanceTracker` class, CSS is automatically injected. Manual import only needed for custom implementations.

---

## Complete Integration Examples

### Example 1: Basic Setup with PerformanceTracker

```javascript
import * as THREE from 'three';
import {
  ClusterLightingSystem,
  PerformanceTracker,
  loadWasm,
  LightType,
  Animation
} from 'three-cluster-lights';

// Setup renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// Load WASM
const wasm = await loadWasm({ preferSIMD: true });

// Create lighting system
const lights = new ClusterLightingSystem(
  renderer,
  wasm,
  0.1,    // near
  1000,   // far
  32, 16, 32,  // cluster resolution
  true    // performance mode
);

// Add lights
lights.addLight({
  type: LightType.POINT,
  position: new THREE.Vector3(0, 5, 0),
  color: new THREE.Color(1, 0.5, 0),
  intensity: 10,
  radius: 15,
  animation: {
    circular: { speed: 1, radius: 5 }
  }
});

// Patch materials
const material = new THREE.MeshStandardMaterial({ color: 0x808080 });
lights.patchMaterial(material);

// Performance tracking
const tracker = new PerformanceTracker(renderer, {
  showFPS: true,
  showCPU: true,
  showGPU: true,
  showMemory: true
});

// Render loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);

  tracker.begin();

  const time = clock.getElapsedTime();
  lights.update(time, camera);
  renderer.render(scene, camera);

  tracker.end();
}
animate();
```

### Example 2: With Light Markers

```javascript
import { ClusterLightingSystem, LightMarkers } from 'three-cluster-lights';

// ... setup lights ...

// Add visual markers
const markers = new LightMarkers(lights, {
  visible: true,
  showGlow: true,
  glowRadius: 0.5
});
markers.init(scene);

// Update in render loop
function animate() {
  // ...
  markers.update(scene);
  // ...
}
```

### Example 3: Bulk Light Addition

```javascript
// Add many lights efficiently
for (let i = 0; i < 1000; i++) {
  lights.addFastLight({
    type: LightType.POINT,
    position: new THREE.Vector3(
      Math.random() * 100 - 50,
      Math.random() * 20,
      Math.random() * 100 - 50
    ),
    color: new THREE.Color(Math.random(), Math.random(), Math.random()),
    intensity: 5 + Math.random() * 10,
    radius: 10 + Math.random() * 20
  });
}
```

---

## WASM Module Usage

The library includes WebAssembly modules for high-performance light processing:

### Loading WASM

```javascript
// Option 1: Using loadWasm helper (recommended) no config required or manual wasm additions
import { loadWasm } from 'three-cluster-lights';
const wasm = await loadWasm({
  preferSIMD: true  // Auto-detect and use SIMD if available
});

// Option 2: You can manually override this and load
const wasm = await WebAssembly.instantiateStreaming(
  fetch('/node_modules/three-cluster-lights/lib/wasm/lights-simd.wasm'),
  { env: { emscripten_notify_memory_growth: () => {} } }
);

// Option 3: If you do this, you can set this up in various ways
import wasmUrl from 'three-cluster-lights/wasm/lights-simd.wasm?url';
const wasm = await WebAssembly.instantiateStreaming(
  fetch(wasmUrl),
  { env: { emscripten_notify_memory_growth: () => {} } }
);
```

### SIMD vs Standard

- **lights-simd.wasm** - SIMD optimized, ~2x faster (recommended if supported)
- **lights.wasm** - Standard version for wider browser compatibility

The `loadWasm()` helper automatically detects SIMD support and loads the appropriate version.

### Building from Source

The WASM source is included for transparency and custom builds:

```bash
# Build standard version
npm run build:wasm

# Build SIMD version
npm run build:wasm-simd

# Build both and copy to public/
npm run build:wasm:all
```

**Requirements:** Emscripten SDK (emcc) must be installed

---

## File Organization

```
lib/
├── index.js                      # Main entry point
├── cluster-lighting-system.js    # Core lighting system
├── cluster-shaders.js            # GLSL shaders for clustering
├── performance-metrics.js        # Low-level performance primitives
├── performance-tracker.js        # High-level performance tracker
├── light-markers.js              # Visual light position markers
├── wasm-loader.js                # WASM loading helper
├── performance-tracker.css       # Performance overlay styles
├── wasm/                         # WebAssembly modules
│   ├── lights.c                  # WASM source code
│   ├── lights.wasm               # Compiled WASM (standard)
│   └── lights-simd.wasm          # Compiled WASM (SIMD optimized)
└── README.md                     # This file
```

---

## Performance Tips

1. **Use `addFastLight()` for bulk operations** - Skips some validation checks
2. **Enable performance mode** - Constructor parameter enables optimizations
3. **Adjust cluster resolution** - Larger grids for more lights (8x8x8 for 10K+ lights)
4. **Use LOD bias** - Reduce quality for distant lights (`setLODBias()`)
5. **Enable dynamic clusters** - Automatically adjusts grid size (`setDynamicClusters(true)`)
6. **Prefer SIMD WASM** - ~2x faster on supporting browsers
7. **Update only changed properties** - Use specific update methods instead of full updates

---

## Browser Compatibility

- **WebAssembly:** Required (all modern browsers)
- **SIMD:** Optional, supported in Chrome 91+, Firefox 89+, Safari 16.4+
- **WebGL 2:** Required for GPU queries
- **EXT_disjoint_timer_query_webgl2:** Optional, for GPU timing

For older browser support, the library will gracefully degrade performance monitoring features.

---

## Notes

- CSS files are **optional** - only needed if using `PerformanceTracker` manually
- JavaScript modules work independently of CSS
- WASM files are pre-compiled and ready to use
- TypeScript definitions coming soon
- All file names use consistent kebab-case convention
