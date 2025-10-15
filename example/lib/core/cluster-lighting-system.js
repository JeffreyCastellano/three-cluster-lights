// cluster-lighting-system.js - Complete WASM clustered lighting system
import { Color, Vector3, Vector4, Vector2, BufferGeometry, Float32BufferAttribute, WebGLRenderTarget, RGBAFormat, FloatType, NearestFilter, UnsignedByteType, RedIntegerFormat, UnsignedShortType, UnsignedIntType, MeshBasicMaterial, Scene, Mesh, DataTexture, MathUtils, PlaneGeometry, PerspectiveCamera, Matrix4 } from 'three';
import { getListMaterial, getMasterMaterial, getSuperMasterMaterial, ShaderVariants, lights_physical_pars_fragment } from './cluster-shaders.js';
import { GPUQuery } from '../performance/performance-metrics.js';

// Light type enumeration
export const LightType = {
  POINT: 0,
  SPOT: 1,
  RECT: 2
};

// Animation type flags (bitwise)
export const Animation = {
  NONE: 0x00,
  CIRCULAR: 0x01,
  LINEAR: 0x02,
  WAVE: 0x04,
  FLICKER: 0x08,
  PULSE: 0x10,
  ROTATE: 0x20
};

// Linear animation modes
export const LinearMode = {
  ONCE: 0,
  LOOP: 1,
  PINGPONG: 2
};

// Pulse animation targets (bitwise)
export const PulseTarget = {
  INTENSITY: 0x01,
  RADIUS: 0x02,
  BOTH: 0x03
};

// Rotation animation modes
export const RotateMode = {
  CONTINUOUS: 0,
  SWING: 1
};

// Level of Detail levels
export const LODLevel = {
  SKIP: 0,      // Don't render
  SIMPLE: 1,    // Minimal quality
  MEDIUM: 2,    // Medium quality
  FULL: 3       // Full quality
};

class FullscreenTriangleGeometry extends BufferGeometry {
  constructor() {
    super();
    this.setAttribute('position', new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  }
}

const tempColor = new Color();
const zeroColor = new Color(0);

// Calculate optimal cluster resolution based on light count
function calculateOptimalClusterResolution(lightCount) {
  if (lightCount > 2000) {
    return { x: 8, y: 8, z: 8 };     // 512 clusters for massive light counts
  } else if (lightCount > 1000) {
    return { x: 12, y: 8, z: 12 };   // 1152 clusters
  } else if (lightCount > 500) {
    return { x: 16, y: 8, z: 16 };   // 2048 clusters
  } else if (lightCount > 200) {
    return { x: 24, y: 12, z: 24 };  // 6912 clusters
  } else {
    return { x: 32, y: 16, z: 32 };  // 16384 clusters for detailed scenes
  }
}

export class ClusterLightingSystem {
  constructor(renderer, ws, near, far, sliceX, sliceY, sliceZ, performanceMode = true) {
    this.renderer = renderer;
    this.wasm = ws.instance;
    this.performanceMode = performanceMode;

    // 2D texture layout configuration - adaptive based on GPU capability
    // Check GPU texture size limit
    const gl = renderer.getContext();
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    // Adaptive texture width based on GPU capability
    // Desktop (16384+): 2048 width - optimal for high light counts
    // Mid-range (8192+): 1024 width - balanced for mobile/desktop
    // Low-end (4096+): 512 width - conservative for mobile
    const LIGHT_TEXTURE_WIDTH = this.maxTextureSize >= 16384 ? 2048 :
                                this.maxTextureSize >= 8192 ? 1024 : 512;

    // Calculate max lights using 2D texture layout (width × height / 2 texels per light)
    // Cap at 32,800 lights for stable performance across all systems
    const theoretical2DMax = Math.floor((LIGHT_TEXTURE_WIDTH * this.maxTextureSize) / 2);
    this.maxSafeLights = Math.min(theoretical2DMax, 32800);
    this.lightTextureWidth = LIGHT_TEXTURE_WIDTH;

    // Pre-allocate WASM memory for max capacity
    const memoryMB = (this.maxSafeLights * 488 / 1024 / 1024).toFixed(2);

    this.wasm.exports.init(this.maxSafeLights);
    
    // Set view frustum parameters
    this.wasm.exports.setViewFrustum(near, far);
    
    // Light data arrays by type
    this.pointLights = [];
    this.spotLights = [];
    this.rectLights = [];
    
    // Track light indices for removal/update
    this.lightTypeMap = new Map(); // Maps global index to {type, typeIndex}
    this.globalLightIndex = 0;
    
    // Track camera movement with version number
    this.cameraMatrixVersion = 0;
    this.lastCameraMatrixVersion = -1;
    this.cameraChanged = false;

    // Advanced cluster caching
    this.clusterDirtyFlags = {
      lightCountChanged: false,
      lightPositionsChanged: false,
      cameraChanged: false,
      hasAnimations: false,
      forceUpdate: false
    };
    this.lastClusterUpdateFrame = -1;

    // Zero-copy optimization
    this.useZeroCopy = true; // Use direct WASM memory (faster)
    this.wasmMemoryBufferVersion = 0; // Track WASM memory reallocations

    // Deferred sorting optimization
    this.deferSorting = true; // Don't sort after every operation (faster)
    this.sortDeferred = false; // Track if sort is needed

    // Object pooling for light objects to reduce GC pressure
    this.lightObjectPool = {
      available: [],
      create() {
        return {
          position: new Vector3(),
          color: new Color(),
          intensity: 1,
          radius: 10,
          decay: 1,
          visible: true,
          animation: null,
          direction: null,
          angle: null,
          penumbra: null,
          width: null,
          height: null,
          normal: null
        };
      },
      acquire() {
        return this.available.length > 0 ? this.available.pop() : this.create();
      },
      release(obj) {
        // Reset to defaults
        obj.position.set(0, 0, 0);
        obj.color.set(1, 1, 1);
        obj.intensity = 1;
        obj.radius = 10;
        obj.decay = 1;
        obj.visible = true;
        obj.animation = null;
        obj.direction = null;
        obj.angle = null;
        obj.penumbra = null;
        obj.width = null;
        obj.height = null;
        obj.normal = null;
        this.available.push(obj);
      }
    };

    // Performance tracking
    this.frameSkip = 0;
    this.maxFrameSkip = performanceMode ? 2 : 0;
    this.hasAnimatedLights = false;
    this.dirtyLightCount = 0;
    this.lastRenderFrame = -1;
    
    // LOD settings (always enabled)
    this.lodBias = 1.0;

    // Feature detection
    this.featureFlags = {
      hasComplexAnimations: false,
      hasSimpleAnimations: false,
      hasMixedTypes: false
    };
    
    this.currentShaderVariant = null;
    this.materialsToUpdate = new Set();
    
    // Dynamic cluster resolution
    this._dynamicClusters = false;
    this._baseSliceX = sliceX;
    this._baseSliceY = sliceY;
    this._baseSliceZ = sliceZ;
    
    this.clusterParams = { value: new Vector4() };
    this.batchCount = { value: 1 };
    this.masterCount = { value: 1 };
    this.camera = new PerspectiveCamera();
    this._near = near;
    this._far = far;
    this.sliceParams = { value: new Vector4(sliceX, sliceY, sliceZ, 1) };
    this.projectionMatrix = { value: null };
    this.viewMatrix = { value: null };
    this.nearZ = { value: 0 };
    this.time = { value: 0 };
    
    // Separate textures for each light type
    this.pointLightTexture = { value: null };
    this.spotLightTexture = { value: null };
    this.rectLightTexture = { value: null };
    this.lightCounts = { value: new Vector3(0, 0, 0) };

    // 2D texture layout uniforms (separate for each light type)
    this.pointLightTextureWidth = { value: this.lightTextureWidth };
    this.spotLightTextureWidth = { value: this.lightTextureWidth };
    this.rectLightTextureWidth = { value: this.lightTextureWidth };
    
    this.masterTexture = { value: null };
    this.superMasterTexture = { value: null };
    this.listTexture = { value: null };
    this.size = { value: new Vector2(1, 1) };
    
    // Performance tuning: Max tiles a light can span (prevents assignment overdraw)
    // Lower = better performance (less overdraw), Higher = better quality (less light clipping)
    // Recommended: 8-16 tiles. Below 8 causes tile boundary artifacts. At 36x18 clusters, 12 tiles = ~1/3 screen width
    this.maxTileSpan = { value: 12.0 };
    
    // Super-master hierarchical early-out control
    // undefined = auto heuristic (enabled when sliceParams.w >= 24, ~6K+ lights)
    // true = force enable, false = force disable
    // TEMPORARILY DISABLED to test if it's causing performance regression
    this.useSuperMaster = false;
    
    // Create proxy geometry
    const proxyGeometry = new PlaneGeometry(2, 2);
    proxyGeometry.isInstancedBufferGeometry = true;
    proxyGeometry.instanceCount = 0;

    this.proxy = new Mesh(proxyGeometry, getListMaterial());
    
    ["pointLightTexture", "spotLightTexture", "rectLightTexture", "lightCounts",
     "pointLightTextureWidth", "spotLightTextureWidth", "rectLightTextureWidth",
     "batchCount", "sliceParams", "clusterParams", "nearZ", "projectionMatrix", "viewMatrix", "maxTileSpan"].forEach((k) => {
      this.proxy.material.uniforms[k] = this[k];
    });
    
    this.proxy.frustumCulled = false;
    this.listScene = new Scene();
    this.listScene.add(this.proxy);

    this.tiler = new Mesh(new FullscreenTriangleGeometry(), getMasterMaterial());

    ["listTexture", "batchCount", "sliceParams"].forEach((k) => {
      this.tiler.material.uniforms[k] = this[k];
    });

    this.tiler.frustumCulled = false;
    this.tileScene = new Scene();
    this.tileScene.add(this.tiler);

    // REMOVED: Super-master scene/mesh (3rd render pass removed for performance with massive light counts)

    // Get camera matrix reference
    this.cameraMatrix = new Float32Array(this.wasm.exports.memory.buffer, this.wasm.exports.getCameraMatrix(), 16);
    this.currentViewMatrix = null;

    // Initialize performance tracking for ASSIGN timing
    this.assignQuery = new GPUQuery(renderer, "#perf-assign-value");

    // WASM CPU timing
    this.wasmTimeEl = document.querySelector("#perf-wasm-value");
    this.wasmTimeValue = 0;
    this.wasmTimeCount = 0;
    this.wasmTimeLastUpdate = 0;

    this._computeClusterParams();
  }

  // ────────────────────────────────────────────────────────────
  //                     MATERIAL PATCHING
  // ────────────────────────────────────────────────────────────


  // ────────────────────────────────────────────────────────────

  get near() { return this._near; }
  set near(v) { 
    this._near = v; 
    this.wasm.exports.setViewFrustum(v, this._far);
    this._computeClusterParams(); 
  }
  get far() { return this._far; }
  set far(v) { 
    this._far = v; 
    this.wasm.exports.setViewFrustum(this._near, v);
    this._computeClusterParams(); 
  }

  // Enable/disable dynamic cluster resolution
  setDynamicClusters(enable) {
    this._dynamicClusters = enable;
    if (enable) {
      this._updateClusterResolution();
    }
  }


  // Force cluster update on next frame (useful after bulk operations)
  forceClusterUpdate() {
    this.clusterDirtyFlags.forceUpdate = true;
  }

  // Enable/disable zero-copy GPU upload optimization
  setZeroCopyMode(enabled) {
    if (this.useZeroCopy !== enabled) {
      this.useZeroCopy = enabled;
      // Force texture recreation to apply new mode
      this.updateLightTextures();
    }
  }

  // Enable/disable deferred sorting (sort once before render, not after every operation)
  setDeferredSorting(enabled) {
    this.deferSorting = enabled;
    // If disabling and sort is pending, do it now
    if (!enabled && this.sortDeferred) {
      this.wasm.exports.sort();
      this.sortDeferred = false;
    }
  }

  // Manually trigger sort (useful when deferred sorting is enabled)
  sortNow() {
    this.wasm.exports.sort();
    this.sortDeferred = false;
  }

  // Update cluster resolution based on light count
  _updateClusterResolution() {
    if (!this._dynamicClusters) return;

    const totalLights = this.pointLightCount + this.spotLightCount + this.rectLightCount;
    const resolution = calculateOptimalClusterResolution(totalLights);

    if (this.sliceParams.value.x !== resolution.x ||
        this.sliceParams.value.y !== resolution.y ||
        this.sliceParams.value.z !== resolution.z) {

      // Use adaptive batch size for high light counts
      // Increased from 512/256 to 1024/512 to reduce fragment shader loop iterations
      // At 32K lights: 1024 batch = ~31 rows (vs 63 with 512) = 50% fewer iterations
      const batchSize = totalLights > 8000 ? 1024 : 512;
      this.sliceParams.value.set(resolution.x, resolution.y, resolution.z,
                                  Math.ceil(Math.max(1, totalLights) / batchSize));
      this._computeClusterParams();

      // Clear render targets to force recreation
      this.clearRenderTargets();
    }
  }

  // Feature detection system - now incremental
  _updateFeatureFlags() {
    const features = this.featureFlags;

    // Update static flags
    features.hasMixedTypes = (this.spotLightCount > 0 || this.rectLightCount > 0);

    // Animation flags are now tracked incrementally during add/remove
    // No need to scan all lights here

    // Select best shader variant
    const lights = {
      pointCount: this.pointLightCount,
      spotCount: this.spotLightCount,
      rectCount: this.rectLightCount,
      totalCount: this.pointLightCount + this.spotLightCount + this.rectLightCount,
      ...features
    };
    
    // Find matching shader variant
    for (const [name, variant] of Object.entries(ShaderVariants)) {
      if (variant.condition(lights)) {
        if (this.currentShaderVariant !== name) {
          this.currentShaderVariant = name;
          this._updateAllMaterials(variant.fragment);
        }
        break;
      }
    }
  }

  _updateAllMaterials(fragmentShader) {
    // Store the fragment shader for later use
    this._currentFragmentShader = fragmentShader;
    
    // Re-patch all tracked materials
    this.materialsToUpdate.forEach(material => {
      material.needsUpdate = true;
      material.__clusteredLightingPatched = false;
    });
  }

  // LOD control methods
  setLODBias(bias) {
    this.lodBias = bias;
    this.wasm.exports.setLODBias(bias);
  }

  getLODBias() {
    return this.wasm.exports.getLODBias();
  }

  // Performance tuning: Control max tile span to prevent assignment overdraw
  setMaxTileSpan(span) {
    this.maxTileSpan.value = Math.max(8.0, Math.min(32.0, span)); // Clamp: min 8 to avoid artifacts, max 32
  }

  getMaxTileSpan() {
    return this.maxTileSpan.value;
  }

  // ────────────────────────────────────────────────────────────
  //         SHADOW SYSTEM REMOVED - NO LONGER USED
  // ────────────────────────────────────────────────────────────

  _computeClusterParams() {
    const v = this.clusterParams.value;
    const vt = this.sliceParams.value;
    v.x = vt.x / this.size.value.x;
    v.y = vt.y / this.size.value.y;
    const fnl = Math.log(this._far / this._near);
    v.z = this.sliceParams.value.z / fnl;
    v.w = this.sliceParams.value.z * Math.log(this._near) / fnl;
  }

  patchMaterial(material) {
    // Track material for updates
    this.materialsToUpdate.add(material);
    
    material.onBeforeCompile = (s) => {
      this._patchShader(s);
      material.uniforms = s.uniforms;
    }
    material.needsUpdate = true;
  }

  _patchShader(s) {
    const u = s.uniforms;
    u.clusterParams = this.clusterParams;
    u.sliceParams = this.sliceParams;
    u.pointLightTexture = this.pointLightTexture;
    u.spotLightTexture = this.spotLightTexture;
    u.rectLightTexture = this.rectLightTexture;
    u.lightCounts = this.lightCounts;
    u.masterTexture = this.masterTexture;
    u.superMasterTexture = this.superMasterTexture;
    u.listTexture = this.listTexture;
    u.pointLightTextureWidth = this.pointLightTextureWidth;
    u.spotLightTextureWidth = this.spotLightTextureWidth;
    u.rectLightTextureWidth = this.rectLightTextureWidth;

    // Enable super-master early-out if texture is present
    if (this.superMasterTexture.value) {
      s.defines = s.defines || {};
      s.defines.USE_SUPER_MASTER = '';
    } else {
      // Clean up define if super-master is disabled
      if (s.defines && s.defines.USE_SUPER_MASTER !== undefined) {
        delete s.defines.USE_SUPER_MASTER;
      }
    }

    // Use the current shader variant or default
    const fragmentCode = this._currentFragmentShader || ShaderVariants.FULL_FEATURED.fragment;
    
    s.fragmentShader = s.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', `
        #include <lights_physical_pars_fragment>
        ${lights_physical_pars_fragment}
      `)
      .replace('#include <lights_fragment_begin>', `
        #include <lights_fragment_begin>
        ${fragmentCode}
      `);
  }

  // Helper to pack animation parameters
  _packAnimationParams(animation) {
    if (!animation) return { flags: 0 };
    
    let flags = 0;
    const params = {
      // Circular
      circSpeed: 0, circRadius: 0,
      // Linear
      targetX: 0, targetY: 0, targetZ: 0, duration: 1, delay: 0, linearMode: LinearMode.ONCE,
      // Wave
      waveAxisX: 0, waveAxisY: 1, waveAxisZ: 0, waveSpeed: 1, waveAmplitude: 1, wavePhase: 0,
      // Flicker
      flickerSpeed: 10, flickerIntensity: 0.3, flickerSeed: Math.random() * 100,
      // Pulse
      pulseSpeed: 1, pulseAmount: 0.5, pulseTarget: PulseTarget.INTENSITY,
      // Rotation
      rotAxisX: 0, rotAxisY: 1, rotAxisZ: 0, rotSpeed: 1, rotAngle: Math.PI / 4, rotMode: RotateMode.CONTINUOUS
    };
    
    if (animation.circular) {
      flags |= Animation.CIRCULAR;
      params.circSpeed = animation.circular.speed || 1;
      params.circRadius = animation.circular.radius || 5;
    }
    
    if (animation.linear) {
      flags |= Animation.LINEAR;
      const target = animation.linear.to || animation.linear.target || new Vector3(0, 0, 0);
      params.targetX = target.x !== undefined ? target.x : target[0] || 0;
      params.targetY = target.y !== undefined ? target.y : target[1] || 0;
      params.targetZ = target.z !== undefined ? target.z : target[2] || 0;
      params.duration = animation.linear.duration || 1;
      params.delay = animation.linear.delay || 0;
      params.linearMode = animation.linear.mode === 'loop' ? LinearMode.LOOP : 
                         animation.linear.mode === 'pingpong' ? LinearMode.PINGPONG : LinearMode.ONCE;
    }
    
    if (animation.wave) {
      flags |= Animation.WAVE;
      const axis = animation.wave.axis || new Vector3(0, 1, 0);
      params.waveAxisX = axis.x !== undefined ? axis.x : axis[0] || 0;
      params.waveAxisY = axis.y !== undefined ? axis.y : axis[1] || 0;
      params.waveAxisZ = axis.z !== undefined ? axis.z : axis[2] || 0;
      params.waveSpeed = animation.wave.speed || 1;
      params.waveAmplitude = animation.wave.amplitude || 1;
      params.wavePhase = animation.wave.phase || 0;
    }
    
    if (animation.flicker) {
      flags |= Animation.FLICKER;
      params.flickerSpeed = animation.flicker.speed || 10;
      params.flickerIntensity = animation.flicker.intensity || 0.3;
      params.flickerSeed = animation.flicker.seed || Math.random() * 100;
    }
    
    if (animation.pulse) {
      flags |= Animation.PULSE;
      params.pulseSpeed = animation.pulse.speed || 1;
      params.pulseAmount = animation.pulse.amount || 0.1;
      let target = 0;
      if (animation.pulse.target === 'intensity' || animation.pulse.target === PulseTarget.INTENSITY) target |= PulseTarget.INTENSITY;
      if (animation.pulse.target === 'radius' || animation.pulse.target === PulseTarget.RADIUS) target |= PulseTarget.RADIUS;
      if (animation.pulse.target === 'both') target = PulseTarget.INTENSITY | PulseTarget.RADIUS;
      params.pulseTarget = target;
    }
    
    if (animation.rotation || animation.rotate) {
      const rot = animation.rotation || animation.rotate;
      flags |= Animation.ROTATE;
      const axis = rot.axis || new Vector3(0, 1, 0);
      params.rotAxisX = axis.x !== undefined ? axis.x : axis[0] || 0;
      params.rotAxisY = axis.y !== undefined ? axis.y : axis[1] || 0;
      params.rotAxisZ = axis.z !== undefined ? axis.z : axis[2] || 0;
      params.rotSpeed = rot.speed || 1;
      // Clamp rotation angle to prevent quaternion flipping at ±180 degrees
      const rawAngle = rot.angle || Math.PI / 4;
      params.rotAngle = MathUtils.clamp(rawAngle, -Math.PI * 0.99, Math.PI * 0.99); // ±179 degrees
      params.rotMode = rot.mode === 'swing' ? RotateMode.SWING : RotateMode.CONTINUOUS;
    }
    
    return { flags, ...params };
  }

  // Fast path for adding mass lights
  addFastLight(light) {
    const p = light.position;
    const c = light.color;
    const intensity = light.intensity || 10;
    const radius = light.radius || 10;
    
    // Use simplified add function in WASM
    const typeIndex = this.wasm.exports.addFast 
      ? this.wasm.exports.addFast(p.x, p.y, p.z, radius, c.r, c.g, c.b, intensity)
      : this.wasm.exports.add(p.x, p.y, p.z, radius, c.r, c.g, c.b, 1.0, 0, 0, intensity);
    
    if (typeIndex >= 0) {
      this.pointLights.push({
        position: p,
        color: c,
        intensity,
        radius,
        decay: 1.0,
        visible: true,
        animation: light.animation || null  // Use the light's animation if provided
      });
      
      const globalIndex = this.globalLightIndex++;
      this.lightTypeMap.set(globalIndex, { type: 'point', typeIndex });
      
      this.hasPointLights = true;
      
      // Update animated lights flag if needed
      if (light.animation) {
        this.hasAnimatedLights = true;
      }
      
      return globalIndex;
    }
    
    return -1;
  }

  addLight(light) {
    // Use fast path for simple point lights in performance mode
    if (this.performanceMode && 
        light.type === 'point' && 
        !light.animation &&
        this.pointLightCount > 100) {
      return this.addFastLight(light);
    }
    
    const p = light.position;
    const c = light.color;
    const intensity = light.intensity || 10;
    const radius = light.radius || 10;
    const decay = light.decay || 2.0;
    const type = light.type || 'point';
    const visible = light.visible !== undefined ? light.visible : true;
    const animation = light.animation || null;
    
    let typeIndex = -1;
    const globalIndex = this.globalLightIndex++;
    
    if (type === 'point') {
      // Handle legacy animation params
      if (!animation && (light.speed || light.animRadius)) {
        // Legacy circular animation
        typeIndex = this.wasm.exports.add(p.x, p.y, p.z, radius, c.r, c.g, c.b, decay, 
                                         light.speed || 0, light.animRadius || 0, intensity);
      } else if (animation) {
        // New animation system
        const animParams = this._packAnimationParams(animation);
        typeIndex = this.wasm.exports.addPointWithAnimation(
          p.x, p.y, p.z, radius, c.r, c.g, c.b, intensity, decay,
          animParams.flags,
          animParams.circSpeed, animParams.circRadius,
          animParams.targetX, animParams.targetY, animParams.targetZ, 
          animParams.duration, animParams.delay, animParams.linearMode,
          animParams.waveAxisX, animParams.waveAxisY, animParams.waveAxisZ,
          animParams.waveSpeed, animParams.waveAmplitude, animParams.wavePhase,
          animParams.flickerSpeed, animParams.flickerIntensity, animParams.flickerSeed,
          animParams.pulseSpeed, animParams.pulseAmount, animParams.pulseTarget
        );
      } else {
        // No animation
        typeIndex = this.wasm.exports.add(p.x, p.y, p.z, radius, c.r, c.g, c.b, decay, 0, 0, intensity);
      }
      
      if (typeIndex >= 0) {
        this.pointLights.push({
          position: p,
          color: c,
          intensity,
          radius,
          decay,
          visible,
          animation
        });

        // Track animation types incrementally
        if (animation || light.speed) {
          this.hasAnimatedLights = true;
          if (animation && (animation.linear || animation.wave || animation.rotation)) {
            this.featureFlags.hasComplexAnimations = true;
          } else if (animation && (animation.circular || animation.pulse || animation.flicker)) {
            this.featureFlags.hasSimpleAnimations = true;
          }
        }
      }
    } else if (type === 'spot') {
      const direction = light.direction || new Vector3(0, -1, 0);
      const angle = light.angle || Math.PI / 4;
      const penumbra = light.penumbra || 0;

      if (animation) {
        const animParams = this._packAnimationParams(animation);
        typeIndex = this.wasm.exports.addSpotWithAnimation(
          p.x, p.y, p.z, radius, c.r, c.g, c.b,
          direction.x, direction.y, direction.z,
          angle, penumbra, decay, intensity,
          animParams.flags,
          animParams.targetX, animParams.targetY, animParams.targetZ,
          animParams.duration, animParams.delay, animParams.linearMode,
          animParams.rotAxisX, animParams.rotAxisY, animParams.rotAxisZ,
          animParams.rotSpeed, animParams.rotAngle, animParams.rotMode,
          animParams.flickerSpeed, animParams.flickerIntensity, animParams.flickerSeed,
          animParams.pulseSpeed, animParams.pulseAmount, animParams.pulseTarget
        );
      } else {
        typeIndex = this.wasm.exports.addSpot(
          p.x, p.y, p.z, radius, c.r, c.g, c.b,
          direction.x, direction.y, direction.z,
          angle, penumbra, decay, intensity
        );
      }

      if (typeIndex >= 0) {
        this.spotLights.push({
          position: p,
          color: c,
          intensity,
          radius,
          decay,
          direction,
          angle,
          penumbra,
          visible,
          animation
        });
        
        if (animation) {
          this.hasAnimatedLights = true;
        }
      }
    } else if (type === 'rect') {
      const width = light.width || 10;
      const height = light.height || 10;
      const normal = light.normal || new Vector3(0, 0, 1);
      const rectDecay = light.decay || 0.5;
      const rectRadius = light.radius || Math.max(width, height) * 2;

      if (animation) {
        const animParams = this._packAnimationParams(animation);
        typeIndex = this.wasm.exports.addRectWithAnimation(
          p.x, p.y, p.z, width, height,
          normal.x, normal.y, normal.z,
          c.r, c.g, c.b, intensity, rectDecay, rectRadius,
          animParams.flags,
          animParams.targetX, animParams.targetY, animParams.targetZ,
          animParams.duration, animParams.delay, animParams.linearMode,
          animParams.rotAxisX, animParams.rotAxisY, animParams.rotAxisZ,
          animParams.rotSpeed, animParams.rotAngle, animParams.rotMode,
          animParams.flickerSpeed, animParams.flickerIntensity, animParams.flickerSeed,
          animParams.pulseSpeed, animParams.pulseAmount, animParams.pulseTarget
        );
      } else {
        typeIndex = this.wasm.exports.addRect(
          p.x, p.y, p.z, width, height,
          normal.x, normal.y, normal.z,
          c.r, c.g, c.b, intensity, rectDecay, rectRadius
        );
      }

      if (typeIndex >= 0) {
        this.rectLights.push({
          position: p,
          color: c,
          intensity,
          radius: rectRadius,
          decay: rectDecay,
          width,
          height,
          normal,
          visible,
          animation
        });
        
        if (animation) {
          this.hasAnimatedLights = true;
        }
      }
    }
    
    if (typeIndex >= 0) {
      this.lightTypeMap.set(globalIndex, { type, typeIndex });
      this.updateLightCounts();
      this.updateLightTextures();
      this.updateProxyGeometry();
      this._computeClusterParams();

      // Mark clusters as dirty
      this.clusterDirtyFlags.lightCountChanged = true;
      this.clusterDirtyFlags.lightPositionsChanged = true;

      // Update feature flags and cluster resolution
      this._updateFeatureFlags();
      this._updateClusterResolution();

      // Defer sorting until render (performance optimization)
      if (this.deferSorting) {
        this.sortDeferred = true;
      } else {
        this.wasm.exports.sort();
      }
    }

    return globalIndex;
  }

  removeLight(globalIndex) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping) return;

    const { type, typeIndex } = mapping;

    if (type === 'point') {
      this.wasm.exports.removePointLight(typeIndex);
      const removedLight = this.pointLights.splice(typeIndex, 1)[0];
      if (removedLight) this.lightObjectPool.release(removedLight);
      this.hasAnimatedLights = this.wasm.exports.getHasAnimatedLights() > 0;
    } else if (type === 'spot') {
      this.wasm.exports.removeSpotLight(typeIndex);
      const removedLight = this.spotLights.splice(typeIndex, 1)[0];
      if (removedLight) this.lightObjectPool.release(removedLight);
    } else if (type === 'rect') {
      this.wasm.exports.removeRectLight(typeIndex);
      const removedLight = this.rectLights.splice(typeIndex, 1)[0];
      if (removedLight) this.lightObjectPool.release(removedLight);
    }
    
    // Update mappings for lights after the removed one
    this.lightTypeMap.delete(globalIndex);
    for (const [gIdx, map] of this.lightTypeMap.entries()) {
      if (map.type === type && map.typeIndex > typeIndex) {
        map.typeIndex--;
      }
    }
    
    this.updateLightCounts();
    this.updateLightTextures();
    this.updateProxyGeometry();
    this._computeClusterParams();

    // Mark clusters as dirty
    this.clusterDirtyFlags.lightCountChanged = true;
    this.clusterDirtyFlags.lightPositionsChanged = true;

    // Update feature flags and cluster resolution
    this._updateFeatureFlags();
    this._updateClusterResolution();

    // Defer sorting until render (performance optimization)
    if (this.deferSorting) {
      this.sortDeferred = true;
    } else {
      this.wasm.exports.sort();
    }
  }

  updateLightPosition(globalIndex, position) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping) return;

    const { type, typeIndex } = mapping;

    if (type === 'point') {
      this.wasm.exports.updatePointLightPosition(typeIndex, position.x, position.y, position.z);
      this.pointLights[typeIndex].position = position;
    } else if (type === 'spot') {
      this.wasm.exports.updateSpotLightPosition(typeIndex, position.x, position.y, position.z);
      this.spotLights[typeIndex].position = position;
    } else if (type === 'rect') {
      this.wasm.exports.updateRectLightPosition(typeIndex, position.x, position.y, position.z);
      this.rectLights[typeIndex].position = position;
    }

    // Mark position change for cluster update
    this.clusterDirtyFlags.lightPositionsChanged = true;

    // Defer sorting until render (performance optimization)
    // Skip sorting entirely if we have very few lights (sorting is pointless and causes index corruption)
    const totalLights = this.pointLightCount + this.spotLightCount + this.rectLightCount;
    if (totalLights <= 2) {
      // Don't sort - with 2 or fewer lights, Morton ordering provides no benefit
      // and causes light index corruption issues
      this.sortDeferred = false;
    } else if (this.deferSorting) {
      this.sortDeferred = true;
    } else {
      this.wasm.exports.sort();
    }
  }

  updateLightColor(globalIndex, color) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping) return;
    
    const { type, typeIndex } = mapping;
    
    if (type === 'point') {
      this.wasm.exports.updatePointLightColor(typeIndex, color.r, color.g, color.b);
      this.pointLights[typeIndex].color = color;
    } else if (type === 'spot') {
      this.wasm.exports.updateSpotLightColor(typeIndex, color.r, color.g, color.b);
      this.spotLights[typeIndex].color = color;
    } else if (type === 'rect') {
      this.wasm.exports.updateRectLightColor(typeIndex, color.r, color.g, color.b);
      this.rectLights[typeIndex].color = color;
    }
  }

  updateLightIntensity(globalIndex, intensity) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping) return;
    
    const { type, typeIndex } = mapping;
    
    if (type === 'point') {
      this.wasm.exports.updatePointLightIntensity(typeIndex, intensity);
      this.pointLights[typeIndex].intensity = intensity;
    } else if (type === 'spot') {
      this.wasm.exports.updateSpotLightIntensity(typeIndex, intensity);
      this.spotLights[typeIndex].intensity = intensity;
    } else if (type === 'rect') {
      this.wasm.exports.updateRectLightIntensity(typeIndex, intensity);
      this.rectLights[typeIndex].intensity = intensity;
    }
  }

  updateLightRadius(globalIndex, radius) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping) return;

    const { type, typeIndex } = mapping;
    
    if (type === 'point') {
      this.wasm.exports.updatePointLightRadius(typeIndex, radius);
      this.pointLights[typeIndex].radius = radius;
    } else if (type === 'spot') {
      this.wasm.exports.updateSpotLightRadius(typeIndex, radius);
      this.spotLights[typeIndex].radius = radius;
    } else if (type === 'rect') {
      this.wasm.exports.updateRectLightRadius(typeIndex, radius);
      this.rectLights[typeIndex].radius = radius;
    }
  }

  updateLightDecay(globalIndex, decay) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping) return;
    
    const { type, typeIndex } = mapping;
    
    if (type === 'point') {
      this.wasm.exports.updatePointLightDecay(typeIndex, decay);
      this.pointLights[typeIndex].decay = decay;
    } else if (type === 'spot') {
      this.wasm.exports.updateSpotLightDecay(typeIndex, decay);
      this.spotLights[typeIndex].decay = decay;
    } else if (type === 'rect') {
      this.wasm.exports.updateRectLightDecay(typeIndex, decay);
      this.rectLights[typeIndex].decay = decay;
    }
  }

  updateLightVisibility(globalIndex, visible) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping) return;
    
    const { type, typeIndex } = mapping;
    
    if (type === 'point') {
      this.wasm.exports.updatePointLightVisibility(typeIndex, visible ? 1 : 0);
      this.pointLights[typeIndex].visible = visible;
    } else if (type === 'spot') {
      this.wasm.exports.updateSpotLightVisibility(typeIndex, visible ? 1 : 0);
      this.spotLights[typeIndex].visible = visible;
    } else if (type === 'rect') {
      this.wasm.exports.updateRectLightVisibility(typeIndex, visible ? 1 : 0);
      this.rectLights[typeIndex].visible = visible;
    }
  }

  updateLightAnimation(globalIndex, animation) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping) return;
    
    const { type, typeIndex } = mapping;
    const animParams = this._packAnimationParams(animation);
    
    if (type === 'point') {
      this.wasm.exports.updatePointLightAnimation(
        typeIndex, animParams.flags,
        animParams.circSpeed, animParams.circRadius,
        animParams.targetX, animParams.targetY, animParams.targetZ,
        animParams.duration, animParams.delay, animParams.linearMode,
        animParams.waveAxisX, animParams.waveAxisY, animParams.waveAxisZ,
        animParams.waveSpeed, animParams.waveAmplitude, animParams.wavePhase,
        animParams.flickerSpeed, animParams.flickerIntensity, animParams.flickerSeed,
        animParams.pulseSpeed, animParams.pulseAmount, animParams.pulseTarget
      );
      this.pointLights[typeIndex].animation = animation;
    } else if (type === 'spot') {
      this.wasm.exports.updateSpotLightAnimation(
        typeIndex, animParams.flags,
        animParams.targetX, animParams.targetY, animParams.targetZ,
        animParams.duration, animParams.delay, animParams.linearMode,
        animParams.rotAxisX, animParams.rotAxisY, animParams.rotAxisZ,
        animParams.rotSpeed, animParams.rotAngle, animParams.rotMode,
        animParams.flickerSpeed, animParams.flickerIntensity, animParams.flickerSeed,
        animParams.pulseSpeed, animParams.pulseAmount, animParams.pulseTarget
      );
      this.spotLights[typeIndex].animation = animation;
    } else if (type === 'rect') {
      this.wasm.exports.updateRectLightAnimation(
        typeIndex, animParams.flags,
        animParams.targetX, animParams.targetY, animParams.targetZ,
        animParams.duration, animParams.delay, animParams.linearMode,
        animParams.rotAxisX, animParams.rotAxisY, animParams.rotAxisZ,
        animParams.rotSpeed, animParams.rotAngle, animParams.rotMode,
        animParams.flickerSpeed, animParams.flickerIntensity, animParams.flickerSeed,
        animParams.pulseSpeed, animParams.pulseAmount, animParams.pulseTarget
      );
      this.rectLights[typeIndex].animation = animation;
    }
    
    this.hasAnimatedLights = this.wasm.exports.getHasAnimatedLights() > 0;
    this._updateFeatureFlags();
  }

  updateLightAnimationProperty(globalIndex, animationType, property, value) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping) return;
    
    const { type, typeIndex } = mapping;
    const light = type === 'point' ? this.pointLights[typeIndex] :
                  type === 'spot' ? this.spotLights[typeIndex] :
                  type === 'rect' ? this.rectLights[typeIndex] : null;
    
    if (!light || !light.animation) return;
    
    // Create updated animation object
    const updatedAnimation = { ...light.animation };
    
    if (!updatedAnimation[animationType]) {
      updatedAnimation[animationType] = {};
    }
    
    updatedAnimation[animationType][property] = value;
    
    // Update via existing method
    this.updateLightAnimation(globalIndex, updatedAnimation);
  }

  // Convenience methods for common animation updates
  updatePulseSpeed(globalIndex, speed) {
    this.updateLightAnimationProperty(globalIndex, 'pulse', 'speed', speed);
  }

  updatePulseAmount(globalIndex, amount) {
    this.updateLightAnimationProperty(globalIndex, 'pulse', 'amount', amount);
  }

  updateFlickerIntensity(globalIndex, intensity) {
    this.updateLightAnimationProperty(globalIndex, 'flicker', 'intensity', intensity);
  }

  updateFlickerSpeed(globalIndex, speed) {
    this.updateLightAnimationProperty(globalIndex, 'flicker', 'speed', speed);
  }

  updateCircularSpeed(globalIndex, speed) {
    this.updateLightAnimationProperty(globalIndex, 'circular', 'speed', speed);
  }

  updateCircularRadius(globalIndex, radius) {
    this.updateLightAnimationProperty(globalIndex, 'circular', 'radius', radius);
  }

  updateWaveSpeed(globalIndex, speed) {
    this.updateLightAnimationProperty(globalIndex, 'wave', 'speed', speed);
  }

  updateWaveAmplitude(globalIndex, amplitude) {
    this.updateLightAnimationProperty(globalIndex, 'wave', 'amplitude', amplitude);
  }

  updateRotationSpeed(globalIndex, speed) {
    this.updateLightAnimationProperty(globalIndex, 'rotation', 'speed', speed);
  }

  updateLinearDuration(globalIndex, duration) {
    this.updateLightAnimationProperty(globalIndex, 'linear', 'duration', duration);
  }

  updateSpotDirection(globalIndex, direction) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping || mapping.type !== 'spot') return;
    
    this.wasm.exports.updateSpotLightDirection(mapping.typeIndex, direction.x, direction.y, direction.z);
    this.spotLights[mapping.typeIndex].direction = direction;
  }

  updateSpotAngle(globalIndex, angle, penumbra) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping || mapping.type !== 'spot') return;
    
    // Ensure penumbra doesn't exceed angle
    const validPenumbra = Math.min(penumbra, angle * 0.99);
    
    this.wasm.exports.updateSpotLightAngle(mapping.typeIndex, angle, validPenumbra);
    this.spotLights[mapping.typeIndex].angle = angle;
    this.spotLights[mapping.typeIndex].penumbra = validPenumbra;
  }

  updateRectSize(globalIndex, width, height) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping || mapping.type !== 'rect') return;
    
    this.wasm.exports.updateRectLightSize(mapping.typeIndex, width, height);
    this.rectLights[mapping.typeIndex].width = width;
    this.rectLights[mapping.typeIndex].height = height;
    
    // Recalculate radius based on new dimensions
    const newRadius = Math.max(width, height) * 3;
    this.wasm.exports.updateRectLightRadius(mapping.typeIndex, newRadius);
    this.rectLights[mapping.typeIndex].radius = newRadius;
  }

  updateRectNormal(globalIndex, normal) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping || mapping.type !== 'rect') return;

    this.wasm.exports.updateRectLightNormal(mapping.typeIndex, normal.x, normal.y, normal.z);
    this.rectLights[mapping.typeIndex].normal = normal;
  }

  // Bulk update multiple lights by their indices without clearing
  // updates: Array of { index: number, properties: { position?, color?, intensity?, ... } }
  bulkUpdateLights(updates) {
    if (!updates || updates.length === 0) return;

    updates.forEach(update => {
      const { index, properties } = update;

      if (properties.position) {
        this.updateLightPosition(index, properties.position);
      }
      if (properties.color) {
        this.updateLightColor(index, properties.color);
      }
      if (properties.intensity !== undefined) {
        this.updateLightIntensity(index, properties.intensity);
      }
      if (properties.radius !== undefined) {
        this.updateLightRadius(index, properties.radius);
      }
      if (properties.decay !== undefined) {
        this.updateLightDecay(index, properties.decay);
      }
      if (properties.visible !== undefined) {
        this.updateLightVisibility(index, properties.visible);
      }
      if (properties.animation !== undefined) {
        this.updateLightAnimation(index, properties.animation);
      }

      // Type-specific updates
      const mapping = this.lightTypeMap.get(index);
      if (mapping) {
        if (mapping.type === 'spot') {
          if (properties.direction) {
            this.updateSpotDirection(index, properties.direction);
          }
          if (properties.angle !== undefined) {
            const penumbra = properties.penumbra !== undefined ? properties.penumbra : this.spotLights[mapping.typeIndex].penumbra;
            this.updateSpotAngle(index, properties.angle, penumbra);
          }
        } else if (mapping.type === 'rect') {
          if (properties.width !== undefined || properties.height !== undefined) {
            const width = properties.width !== undefined ? properties.width : this.rectLights[mapping.typeIndex].width;
            const height = properties.height !== undefined ? properties.height : this.rectLights[mapping.typeIndex].height;
            this.updateRectSize(index, width, height);
          }
          if (properties.normal) {
            this.updateRectNormal(index, properties.normal);
          }
        }
      }
    });

    // Single texture update at the end
    this.updateLightTextures();
  }

  clearLights() {
    // Safety check - don't clear if WASM not initialized yet
    if (!this.wasm || !this.wasm.exports) {
      console.warn('[ClusterLightingSystem] clearLights called before WASM initialized');
      return;
    }

    this.wasm.exports.reset();
    this.pointLights = [];
    this.spotLights = [];
    this.rectLights = [];
    this.lightTypeMap.clear();
    this.globalLightIndex = 0;
    this.hasAnimatedLights = false;

    // Dispose old textures properly to prevent memory leaks
    if (this.pointLightTexture.value) {
      this.pointLightTexture.value.dispose();
      this.pointLightTexture.value = null;
    }
    if (this.spotLightTexture.value) {
      this.spotLightTexture.value.dispose();
      this.spotLightTexture.value = null;
    }
    if (this.rectLightTexture.value) {
      this.rectLightTexture.value.dispose();
      this.rectLightTexture.value = null;
    }

    this.updateLightCounts();
    this.updateLightTextures();
    this.updateProxyGeometry();
    this._computeClusterParams();
    this.clearRenderTargets();

    // Reset dirty flags
    this.sortDeferred = false;
    this.clusterDirtyFlags.lightCountChanged = false;
    this.clusterDirtyFlags.lightPositionsChanged = false;
    this._loggedUpdate = false; // Reset debug flag

    // Reset feature flags
    this._updateFeatureFlags();
    this._updateClusterResolution();
  }

  clearRenderTargets() {
    if (this.listTarget) {
      this.listTarget.dispose();
      this.listTarget = null;
    }
    if (this.masterTarget) {
      this.masterTarget.dispose();
      this.masterTarget = null;
    }
    if (this.superMasterTarget) {
      this.superMasterTarget.dispose();
      this.superMasterTarget = null;
    }
  }

  updateLightCounts() {
    const pointCount = this.wasm.exports.getPointLightCount();
    const spotCount = this.wasm.exports.getSpotLightCount();
    const rectCount = this.wasm.exports.getRectLightCount();
    
    this.lightCounts.value.set(pointCount, spotCount, rectCount);
    
    const totalCount = pointCount + spotCount + rectCount;
    this.batchCount.value = Math.ceil(Math.max(1, totalCount) / 32);
    
    // Adaptive batch size: use 1024 for high counts to reduce master rows
    // At 32K lights: 1024 batch = ~31 rows (vs 63 with 512) = 50% reduction in fragment shader loops
    const batchSize = totalCount > 8000 ? 1024 : 512;
    const oldW = this.sliceParams.value.w;
    const newW = Math.ceil(Math.max(1, totalCount) / batchSize);
    this.sliceParams.value.w = newW;
    
    // Store counts for easy access
    this.pointLightCount = pointCount;
    this.spotLightCount = spotCount;
    this.rectLightCount = rectCount;
    
    // Update has flags
    this.hasPointLights = pointCount > 0;
    this.hasSpotLights = spotCount > 0;
    this.hasRectLights = rectCount > 0;
  }

  updateLightTextures() {
    const pointCount = this.wasm.exports.getPointLightCount();
    const spotCount = this.wasm.exports.getSpotLightCount();
    const rectCount = this.wasm.exports.getRectLightCount();

    // Calculate 2D texture dimensions
    const TEXTURE_WIDTH = this.lightTextureWidth;
    const texelsNeeded = pointCount * 2;
    const textureHeight = Math.ceil(texelsNeeded / TEXTURE_WIDTH);

    // WASM allocates exactly pointCount * 2 texels (no padding)
    const actualFloats = pointCount * 2 * 4; // Actual WASM allocation

    // Only recreate textures if size changed significantly (avoid thrashing)
    const recreatePoint = !this.pointLightTexture.value ||
      (pointCount > 0 && (
        this.pointLightTexture.value.image.width !== TEXTURE_WIDTH ||
        this.pointLightTexture.value.image.height !== textureHeight
      ));
    const recreateSpot = !this.spotLightTexture.value ||
      (spotCount > 0 && this.spotLightTexture.value.image.width !== spotCount * 4);
    const recreateRect = !this.rectLightTexture.value ||
      (rectCount > 0 && this.rectLightTexture.value.image.width !== rectCount * 5);

    // Point light texture - 2D layout
    if (recreatePoint) {
      if (this.pointLightTexture.value) {
        this.pointLightTexture.value.dispose();
        this.pointLightTexture.value = null;
      }
    }

    if (pointCount > 0 && recreatePoint) {
      // Get WASM data pointer and create a view of the actual allocated memory
      const wasmDataPtr = this.wasm.exports.getPointLightTexture();

      // Verify alignment
      if (wasmDataPtr % 4 !== 0) {
        console.error(`[ClusterLightingSystem] WASM pointer not aligned: ${wasmDataPtr}`);
        return;
      }

      const wasmData = new Float32Array(
        this.wasm.exports.memory.buffer,
        wasmDataPtr,
        actualFloats  // Only the actual allocated data
      );
      // Zero-copy mode: Use WASM memory directly when possible
      const paddedFloats = TEXTURE_WIDTH * textureHeight * 4;
      const canUseZeroCopy = this.useZeroCopy && (actualFloats === paddedFloats);

      if (canUseZeroCopy) {

        // Store reference to current buffer version
        this.wasmMemoryBufferVersion++;
        this.pointLightTextureData = wasmData; // Direct reference

        this.pointLightTexture.value = new DataTexture(
          wasmData, // ← Direct WASM memory reference
          TEXTURE_WIDTH,
          textureHeight,
          RGBAFormat,
          FloatType
        );
      } else {
        // COPY MODE: Need padding or zero-copy disabled

        // Reuse existing buffer if size matches
        if (!this.pointLightTextureData || this.pointLightTextureData.length !== paddedFloats) {
          this.pointLightTextureData = new Float32Array(paddedFloats);
        }

        // Copy WASM data into padded array
        this.pointLightTextureData.set(wasmData);

        this.pointLightTexture.value = new DataTexture(
          this.pointLightTextureData,
          TEXTURE_WIDTH,
          textureHeight,
          RGBAFormat,
          FloatType
        );
      }

      this.pointLightTexture.value.minFilter = NearestFilter;
      this.pointLightTexture.value.magFilter = NearestFilter;
      this.pointLightTexture.value.needsUpdate = true;

    } else if (this.pointLightTexture.value && pointCount > 0) {
      // Update existing texture with fresh WASM data
      const wasmDataPtr = this.wasm.exports.getPointLightTexture();

      if (wasmDataPtr % 4 !== 0) {
        console.error(`[ClusterLightingSystem] WASM pointer not aligned in update: ${wasmDataPtr}`);
        this.pointLightTexture.value.needsUpdate = true;
        return;
      }

      const wasmData = new Float32Array(
        this.wasm.exports.memory.buffer,
        wasmDataPtr,
        actualFloats
      );

      // Copy into texture's data array
      this.pointLightTexture.value.image.data.set(wasmData);
      this.pointLightTexture.value.needsUpdate = true;
    }

    // Spot light texture
    if (recreateSpot) {
      if (this.spotLightTexture.value) {
        this.spotLightTexture.value.dispose();
        this.spotLightTexture.value = null;
      }
    }

    if (spotCount > 0 && recreateSpot) {
      const wasmDataPtr = this.wasm.exports.getSpotLightTexture();
      const spotFloats = spotCount * 4 * 4;

      const wasmView = new Float32Array(
        this.wasm.exports.memory.buffer,
        wasmDataPtr,
        spotFloats
      );

      this.spotLightTexture.value = new DataTexture(
        wasmView,
        spotCount * 4,
        1,
        RGBAFormat,
        FloatType
      );
      this.spotLightTexture.value.minFilter = NearestFilter;
      this.spotLightTexture.value.magFilter = NearestFilter;
      this.spotLightTexture.value.needsUpdate = true;
    } else if (this.spotLightTexture.value && spotCount > 0) {
      // Update existing texture with fresh WASM data
      const wasmDataPtr = this.wasm.exports.getSpotLightTexture();
      const spotFloats = spotCount * 4 * 4;

      if (wasmDataPtr % 4 !== 0) {
        console.error(`[ClusterLightingSystem] Spot light WASM pointer not aligned in update: ${wasmDataPtr}`);
        this.spotLightTexture.value.needsUpdate = true;
        return;
      }

      // Check if the texture data buffer is detached (happens when WASM memory grows)
      const textureData = this.spotLightTexture.value.image.data;
      if (textureData.buffer.byteLength === 0 || textureData.buffer !== this.wasm.exports.memory.buffer) {
        // Buffer is detached or from old memory, recreate texture
        const wasmView = new Float32Array(
          this.wasm.exports.memory.buffer,
          wasmDataPtr,
          spotFloats
        );
        this.spotLightTexture.value = new DataTexture(
          wasmView,
          spotCount * 4,
          1,
          RGBAFormat,
          FloatType
        );
        this.spotLightTexture.value.minFilter = NearestFilter;
        this.spotLightTexture.value.magFilter = NearestFilter;
      } else {
        // Buffer is still valid, just update it
        const wasmData = new Float32Array(
          this.wasm.exports.memory.buffer,
          wasmDataPtr,
          spotFloats
        );
        textureData.set(wasmData);
      }
      this.spotLightTexture.value.needsUpdate = true;
    }

    // Rect light texture
    if (recreateRect) {
      if (this.rectLightTexture.value) {
        this.rectLightTexture.value.dispose();
        this.rectLightTexture.value = null;
      }
    }

    if (rectCount > 0 && recreateRect) {
      const wasmDataPtr = this.wasm.exports.getRectLightTexture();
      const rectFloats = rectCount * 5 * 4;

      const wasmView = new Float32Array(
        this.wasm.exports.memory.buffer,
        wasmDataPtr,
        rectFloats
      );

      this.rectLightTexture.value = new DataTexture(
        wasmView,
        rectCount * 5,
        1,
        RGBAFormat,
        FloatType
      );
      this.rectLightTexture.value.minFilter = NearestFilter;
      this.rectLightTexture.value.magFilter = NearestFilter;
      this.rectLightTexture.value.needsUpdate = true;
    } else if (this.rectLightTexture.value && rectCount > 0) {
      // Update existing texture with fresh WASM data
      const wasmDataPtr = this.wasm.exports.getRectLightTexture();
      const rectFloats = rectCount * 5 * 4;

      if (wasmDataPtr % 4 !== 0) {
        console.error(`[ClusterLightingSystem] Rect light WASM pointer not aligned in update: ${wasmDataPtr}`);
        this.rectLightTexture.value.needsUpdate = true;
        return;
      }

      // Check if the texture data buffer is detached (happens when WASM memory grows)
      const textureData = this.rectLightTexture.value.image.data;
      if (textureData.buffer.byteLength === 0 || textureData.buffer !== this.wasm.exports.memory.buffer) {
        // Buffer is detached or from old memory, recreate texture
        const wasmView = new Float32Array(
          this.wasm.exports.memory.buffer,
          wasmDataPtr,
          rectFloats
        );
        this.rectLightTexture.value = new DataTexture(
          wasmView,
          rectCount * 5,
          1,
          RGBAFormat,
          FloatType
        );
        this.rectLightTexture.value.minFilter = NearestFilter;
        this.rectLightTexture.value.magFilter = NearestFilter;
      } else {
        // Buffer is still valid, just update it
        const wasmData = new Float32Array(
          this.wasm.exports.memory.buffer,
          wasmDataPtr,
          rectFloats
        );
        textureData.set(wasmData);
      }
      this.rectLightTexture.value.needsUpdate = true;
    }
  }

  updateProxyGeometry() {
    const totalCount = this.pointLights.length + this.spotLights.length + this.rectLights.length;
    this.proxy.geometry.instanceCount = totalCount;
  }

  // ──────────────────────────────────────────────────────────────
  //                   LIGHT EXPORT/QUERY
  // ──────────────────────────────────────────────────────────────
  exportLights() {
    const lightData = [];

    // Export point lights
    this.pointLights.forEach((light, index) => {
      lightData.push({
        ...light,
        type: 'point',
        globalIndex: Array.from(this.lightTypeMap.entries()).find(([_, m]) => m.type === 'point' && m.typeIndex === index)?.[0]
      });
    });

    // Export spot lights
    this.spotLights.forEach((light, index) => {
      lightData.push({
        ...light,
        type: 'spot',
        globalIndex: Array.from(this.lightTypeMap.entries()).find(([_, m]) => m.type === 'spot' && m.typeIndex === index)?.[0]
      });
    });

    // Export rect lights
    this.rectLights.forEach((light, index) => {
      lightData.push({
        ...light,
        type: 'rect',
        globalIndex: Array.from(this.lightTypeMap.entries()).find(([_, m]) => m.type === 'rect' && m.typeIndex === index)?.[0]
      });
    });
    
    return lightData;
  }

  importLights(lightData) {
    this.clearLights();
    
    lightData.forEach(light => {
      this.addLight(light);
    });
    
    if (this.pointLightTexture.value) this.pointLightTexture.value.needsUpdate = true;
    if (this.spotLightTexture.value) this.spotLightTexture.value.needsUpdate = true;
    if (this.rectLightTexture.value) this.rectLightTexture.value.needsUpdate = true;
  }

  // Get LOD information for debugging
  getLightLOD(globalIndex) {
    const mapping = this.lightTypeMap.get(globalIndex);
    if (!mapping) return -1;
    
    const { type, typeIndex } = mapping;
    
    if (type === 'point') {
      return this.wasm.exports.getPointLightLOD(typeIndex);
    } else if (type === 'spot') {
      return this.wasm.exports.getSpotLightLOD(typeIndex);
    } else if (type === 'rect') {
      return this.wasm.exports.getRectLightLOD(typeIndex);
    }
    
    return -1;
  }

  config(lights, shuffle) {
    this.clearLights();

    lights.forEach((l) => {
      this.addLight(l);
    });

    if (!shuffle) {
      this.wasm.exports.sort();
    }

    this.updateLightCounts();
    this.updateLightTextures();
    this._computeClusterParams();
    this.updateProxyGeometry();
    this.clearRenderTargets();
  }

  // Bulk config for point lights only - single WASM call for massive performance
  // Supports all animation types: circular, wave, flicker, pulse
  bulkConfigPointLights(lights, append = false) {
    // Only clear if not appending
    if (!append) {
      this.clearLights();
    }

    const count = lights.length;
    if (count === 0) return;

    // Check if using fallback (no real WASM memory)
    // ASM.js has bulkAddPointLights so we should use it
    const isFallback = !this.wasm.exports.memory.grow && !this.wasm.exports.bulkAddPointLights;

    if (isFallback) {
      // Use simple direct add for fallback
      for (const light of lights) {
        let flags = Animation.NONE;
        if (light.animation) {
          if (light.animation.circular) flags |= Animation.CIRCULAR;
          if (light.animation.wave) flags |= Animation.WAVE;
          if (light.animation.flicker) flags |= Animation.FLICKER;
          if (light.animation.pulse) flags |= Animation.PULSE;
        }

        const index = this.wasm.exports.add(
          light.position.x, light.position.y, light.position.z,
          light.radius || 10,
          light.color.r, light.color.g, light.color.b,
          light.decay || 2,
          flags,
          0, // animData pointer (unused in fallback)
          light.intensity || 1
        );

        if (index >= 0) {
          this.pointLights.push({
            position: light.position.clone(),
            color: light.color.clone(),
            intensity: light.intensity || 1,
            radius: light.radius || 10,
            decay: light.decay || 2,
            animation: light.animation
          });

          this.lightTypeMap.set(this.globalLightIndex++, {
            type: 'point',
            typeIndex: index
          });
        }
      }

      this.updateLightCounts();
      this.updateLightTextures();
      this._computeClusterParams();
      this.updateProxyGeometry();
      this.clearRenderTargets();
      return;
    }

    // Track starting index for appending
    const startIndex = append ? this.pointLights.length : 0;

    // Create temporary JS typed arrays
    const positions = new Float32Array(count * 4);
    const colors = new Float32Array(count * 4);
    const decays = new Float32Array(count);
    const animFlags = new Uint32Array(count);
    const animParams = new Float32Array(count * 14); // [circular(2), wave(6), flicker(3), pulse(3)]

    // Pack data
    for (let i = 0; i < count; i++) {
      const light = lights[i];
      const pi = i * 4;
      const ai = i * 14;

      // Position and radius
      positions[pi] = light.position.x;
      positions[pi + 1] = light.position.y;
      positions[pi + 2] = light.position.z;
      positions[pi + 3] = light.radius || 10;

      // Color and intensity
      colors[pi] = light.color.r;
      colors[pi + 1] = light.color.g;
      colors[pi + 2] = light.color.b;
      colors[pi + 3] = light.intensity !== undefined ? light.intensity : 10;

      // Decay
      decays[i] = light.decay !== undefined ? light.decay : 2;

      // Animation flags and params
      let flags = Animation.NONE;

      if (light.animation) {
        if (light.animation.circular) {
          flags |= Animation.CIRCULAR;
          animParams[ai] = light.animation.circular.speed || 1;
          animParams[ai + 1] = light.animation.circular.radius || 1;
          this.hasAnimatedLights = true;
        }

        if (light.animation.wave) {
          flags |= Animation.WAVE;
          const wave = light.animation.wave;
          animParams[ai + 2] = wave.axis[0];
          animParams[ai + 3] = wave.axis[1];
          animParams[ai + 4] = wave.axis[2];
          animParams[ai + 5] = wave.speed || 1;
          animParams[ai + 6] = wave.amplitude || 1;
          animParams[ai + 7] = wave.phase || 0;
          this.hasAnimatedLights = true;
        }

        if (light.animation.flicker) {
          flags |= Animation.FLICKER;
          animParams[ai + 8] = light.animation.flicker.speed || 1;
          animParams[ai + 9] = light.animation.flicker.intensity || 0.5;
          animParams[ai + 10] = light.animation.flicker.seed || 0;
          this.hasAnimatedLights = true;
        }

        if (light.animation.pulse) {
          flags |= Animation.PULSE;
          animParams[ai + 11] = light.animation.pulse.speed || 1;
          animParams[ai + 12] = light.animation.pulse.amount || 0.5;
          animParams[ai + 13] = light.animation.pulse.target || PulseTarget.INTENSITY;
          this.hasAnimatedLights = true;
        }
      }

      animFlags[i] = flags;

      // Track in JS arrays
      this.pointLights.push({
        position: light.position.clone(),
        color: light.color.clone(),
        intensity: light.intensity || 1,
        radius: light.radius || 10,
        decay: light.decay || 2,
        animation: light.animation
      });

      // Map global index (use proper index when appending)
      this.lightTypeMap.set(this.globalLightIndex++, {
        type: 'point',
        typeIndex: startIndex + i
      });
    }

    // Copy arrays to WASM memory (use safe offsets with proper alignment)
    // IMPORTANT: Get fresh memory buffer reference each time (may be reallocated)
    const mem = this.wasm.exports.memory.buffer;

    // Calculate required memory size
    const requiredSize = count * (16 + 16 + 4 + 4 + 14 * 4); // pos + col + dec + flags + animParams
    const baseOffset = 8 * 1024 * 1024; // 8MB offset - safe past light storage (~4MB max)
    const totalNeeded = baseOffset + requiredSize;

    // Check if memory buffer is large enough
    if (mem.byteLength < totalNeeded) {
      console.warn(`[BulkConfig] Memory buffer too small (${mem.byteLength} bytes), need ${totalNeeded} bytes. Expanding...`);
      // Expand the memory buffer if possible (only for real WASM)
      if (this.wasm.exports.memory.grow) {
        const pagesNeeded = Math.ceil((totalNeeded - mem.byteLength) / (64 * 1024));
        try {
          this.wasm.exports.memory.grow(pagesNeeded);
          // Re-get the buffer after growth
          const newMem = this.wasm.exports.memory.buffer;
        } catch (e) {
          console.error(`[BulkConfig] Failed to grow memory:`, e);
        }
      }
    }

    // Calculate aligned offsets for each array
    const posOffset = baseOffset;
    const colOffset = posOffset + count * 16;    // 4 floats * 4 bytes = 16 bytes per light
    const decOffset = colOffset + count * 16;    // 4 floats * 4 bytes = 16 bytes per light
    const flagOffset = decOffset + count * 4;    // 1 float * 4 bytes = 4 bytes per light
    const animOffset = flagOffset + count * 4;   // 1 uint32 * 4 bytes = 4 bytes per light


    // Get fresh reference after potential growth
    const finalMem = this.wasm.exports.memory.buffer;

    new Float32Array(finalMem, posOffset, count * 4).set(positions);
    new Float32Array(finalMem, colOffset, count * 4).set(colors);
    new Float32Array(finalMem, decOffset, count).set(decays);
    new Uint32Array(finalMem, flagOffset, count).set(animFlags);
    new Float32Array(finalMem, animOffset, count * 14).set(animParams);


    // Single WASM call to initialize all lights
    const added = this.wasm.exports.bulkAddPointLights(
      count,
      posOffset,
      colOffset,
      decOffset,
      flagOffset,
      animOffset
    );

    // Only update everything if this is the final batch (not appending)
    if (!append) {
      // Only sort if not deferred
      if (!this.deferSorting) {
        this.wasm.exports.sort();
      } else {
        this.sortDeferred = true;
      }

      // Force WASM to populate the texture data before we read it
      this.wasm.exports.update(0);

      this.updateLightCounts();
      this.updateLightTextures();
      this._computeClusterParams();
      this.updateProxyGeometry();
      this.clearRenderTargets();
    } else {
      // When appending, just mark sorting as deferred
      // Don't call update() or updateLightTextures() - they'll fail with partial data
      this.sortDeferred = true;
      this.updateLightCounts();
    }
  }

  // Finalize progressive loading - call after all batches are appended
  finalizeProgressiveLoading() {
    // Sort if needed
    if (this.sortDeferred) {
      this.wasm.exports.sort();
      this.sortDeferred = false;
    }

    // Force WASM to populate texture data with all lights
    this.wasm.exports.update(0);

    // Update textures and cluster params
    this.updateLightTextures();
    this._computeClusterParams();
    this.updateProxyGeometry();
    this.clearRenderTargets();

  }

  // Bulk config for mixed light types (point, spot, rect) - single WASM call
  // Supports all animation types for all light types
  bulkConfigLights(lights, shuffle = false) {
    this.clearLights();

    const count = lights.length;
    if (count === 0) return;

    // Count each type to allocate spot/rect param arrays
    let spotCount = 0, rectCount = 0;
    for (let i = 0; i < count; i++) {
      if (lights[i].type === 'spot') spotCount++;
      else if (lights[i].type === 'rect') rectCount++;
    }

    // Create temporary JS typed arrays
    const types = new Uint8Array(count);           // 0=point, 1=spot, 2=rect
    const positions = new Float32Array(count * 4);
    const colors = new Float32Array(count * 4);
    const decays = new Float32Array(count);
    const animFlags = new Uint32Array(count);
    const animParams = new Float32Array(count * 14);
    const spotParams = new Float32Array(spotCount * 6);   // dirX,dirY,dirZ,angle,penumbra,pad
    const rectParams = new Float32Array(rectCount * 6);   // width,height,normalX,normalY,normalZ,pad

    let spotIdx = 0, rectIdx = 0;

    // Pack data
    for (let i = 0; i < count; i++) {
      const light = lights[i];
      const pi = i * 4;
      const ai = i * 14;

      // Type
      if (light.type === 'spot') types[i] = 1;
      else if (light.type === 'rect') types[i] = 2;
      else types[i] = 0;  // point

      // Position and radius
      positions[pi] = light.position.x;
      positions[pi + 1] = light.position.y;
      positions[pi + 2] = light.position.z;
      positions[pi + 3] = light.radius || 10;

      // Color and intensity
      colors[pi] = light.color.r;
      colors[pi + 1] = light.color.g;
      colors[pi + 2] = light.color.b;
      colors[pi + 3] = light.intensity !== undefined ? light.intensity : 10;

      // Decay
      decays[i] = light.decay !== undefined ? light.decay : 2;

      // Type-specific params
      if (light.type === 'spot') {
        const si = spotIdx * 6;
        spotParams[si] = light.direction.x;
        spotParams[si + 1] = light.direction.y;
        spotParams[si + 2] = light.direction.z;
        spotParams[si + 3] = light.angle;
        spotParams[si + 4] = light.penumbra || 0;
        spotParams[si + 5] = 0; // padding
        spotIdx++;
      } else if (light.type === 'rect') {
        const ri = rectIdx * 6;
        rectParams[ri] = light.width;
        rectParams[ri + 1] = light.height;
        rectParams[ri + 2] = light.normal.x;
        rectParams[ri + 3] = light.normal.y;
        rectParams[ri + 4] = light.normal.z;
        rectParams[ri + 5] = 0; // padding
        rectIdx++;
      }

      // Animation flags and params
      let flags = Animation.NONE;

      if (light.animation) {
        // Point light animations
        if (light.animation.circular) {
          flags |= Animation.CIRCULAR;
          animParams[ai] = light.animation.circular.speed || 1;
          animParams[ai + 1] = light.animation.circular.radius || 1;
          this.hasAnimatedLights = true;
        }

        if (light.animation.wave) {
          flags |= Animation.WAVE;
          const wave = light.animation.wave;
          animParams[ai + 2] = wave.axis[0];
          animParams[ai + 3] = wave.axis[1];
          animParams[ai + 4] = wave.axis[2];
          animParams[ai + 5] = wave.speed || 1;
          animParams[ai + 6] = wave.amplitude || 1;
          animParams[ai + 7] = wave.phase || 0;
          this.hasAnimatedLights = true;
        }

        if (light.animation.flicker) {
          flags |= Animation.FLICKER;
          animParams[ai + 8] = light.animation.flicker.speed || 1;
          animParams[ai + 9] = light.animation.flicker.intensity || 0.5;
          animParams[ai + 10] = light.animation.flicker.seed || 0;
          this.hasAnimatedLights = true;
        }

        if (light.animation.pulse) {
          flags |= Animation.PULSE;
          animParams[ai + 11] = light.animation.pulse.speed || 1;
          animParams[ai + 12] = light.animation.pulse.amount || 0.5;
          animParams[ai + 13] = light.animation.pulse.target || PulseTarget.INTENSITY;
          this.hasAnimatedLights = true;
        }

        // Spot/Rect animations
        if (light.animation.linear) {
          flags |= Animation.LINEAR;
          const linear = light.animation.linear;
          animParams[ai] = linear.to.x;
          animParams[ai + 1] = linear.to.y;
          animParams[ai + 2] = linear.to.z;
          animParams[ai + 3] = linear.duration || 1;
          animParams[ai + 4] = linear.delay || 0;
          animParams[ai + 5] = linear.mode === 'loop' ? 1 : (linear.mode === 'pingpong' ? 2 : 0);
          this.hasAnimatedLights = true;
        }

        if (light.animation.rotation) {
          flags |= Animation.ROTATE;
          const rotation = light.animation.rotation;
          animParams[ai + 6] = rotation.axis[0];
          animParams[ai + 7] = rotation.axis[1];
          animParams[ai + 8] = rotation.axis[2];
          animParams[ai + 9] = rotation.speed || 1;
          animParams[ai + 10] = rotation.angle || Math.PI;
          this.hasAnimatedLights = true;
        }
      }

      animFlags[i] = flags;

      // Track in JS arrays
      if (light.type === 'spot') {
        this.spotLights.push({
          position: light.position.clone(),
          direction: light.direction.clone(),
          color: light.color.clone(),
          intensity: light.intensity || 1,
          radius: light.radius || 10,
          decay: light.decay || 2,
          angle: light.angle,
          penumbra: light.penumbra || 0,
          animation: light.animation
        });
        this.lightTypeMap.set(this.globalLightIndex++, {
          type: 'spot',
          typeIndex: this.spotLights.length - 1
        });
      } else if (light.type === 'rect') {
        this.rectLights.push({
          position: light.position.clone(),
          color: light.color.clone(),
          intensity: light.intensity || 1,
          radius: light.radius || 10,
          decay: light.decay || 2,
          width: light.width,
          height: light.height,
          normal: light.normal.clone(),
          animation: light.animation
        });
        this.lightTypeMap.set(this.globalLightIndex++, {
          type: 'rect',
          typeIndex: this.rectLights.length - 1
        });
      } else {
        this.pointLights.push({
          position: light.position.clone(),
          color: light.color.clone(),
          intensity: light.intensity || 1,
          radius: light.radius || 10,
          decay: light.decay || 2,
          animation: light.animation
        });
        this.lightTypeMap.set(this.globalLightIndex++, {
          type: 'point',
          typeIndex: this.pointLights.length - 1
        });
      }
    }

    // Copy arrays to WASM memory
    const mem = this.wasm.exports.memory.buffer;
    const baseOffset = 8 * 1024 * 1024; // 8MB offset - safe past light storage

    const typeOffset = baseOffset;
    const posOffset = typeOffset + count * 4;         // Align to 4 bytes
    const colOffset = posOffset + count * 16;
    const decOffset = colOffset + count * 16;
    const flagOffset = decOffset + count * 4;
    const animOffset = flagOffset + count * 4;
    const spotOffset = animOffset + count * 56;      // 14 floats * 4 bytes
    const rectOffset = spotOffset + spotCount * 24;  // 6 floats * 4 bytes


    new Uint8Array(mem, typeOffset, count).set(types);
    new Float32Array(mem, posOffset, count * 4).set(positions);
    new Float32Array(mem, colOffset, count * 4).set(colors);
    new Float32Array(mem, decOffset, count).set(decays);
    new Uint32Array(mem, flagOffset, count).set(animFlags);
    new Float32Array(mem, animOffset, count * 14).set(animParams);
    if (spotCount > 0) new Float32Array(mem, spotOffset, spotCount * 6).set(spotParams);
    if (rectCount > 0) new Float32Array(mem, rectOffset, rectCount * 6).set(rectParams);

    // Single WASM call to initialize all lights
    const added = this.wasm.exports.bulkAddLights(
      count,
      typeOffset,
      posOffset,
      colOffset,
      decOffset,
      flagOffset,
      animOffset,
      spotOffset,
      rectOffset
    );

    if (!shuffle) {
      this.wasm.exports.sort();
    }

    this.updateLightCounts();
    this.updateLightTextures();
    this._computeClusterParams();
    this.updateProxyGeometry();
    this.clearRenderTargets();

  }

  // ────────────────────────────────────────────────────────────
  //              RENDERING & UPDATE METHODS
  // ────────────────────────────────────────────────────────────

  update(time, camera, scene = null) {
    this.time.value = time;
    this.currentViewMatrix = camera.matrixWorldInverse.elements;

    this.camera.copy(camera);
    this.camera.updateMatrixWorld();
    
    this.nearZ.value = camera.near;
    this.projectionMatrix.value = camera.projectionMatrix;
    this.viewMatrix.value = camera.matrixWorldInverse;

    // Efficient camera change detection using matrix version
    if (camera.matrixWorldInverse.elements !== this.currentViewMatrix) {
      this.cameraMatrixVersion++;
      this.currentViewMatrix = camera.matrixWorldInverse.elements;
    }

    this.cameraChanged = this.cameraMatrixVersion !== this.lastCameraMatrixVersion;
    this.lastCameraMatrixVersion = this.cameraMatrixVersion;

    // Update camera matrix for WASM (recreate view if buffer was detached due to memory growth)
    if (this.cameraMatrix.buffer.byteLength === 0) {
      this.cameraMatrix = new Float32Array(this.wasm.exports.memory.buffer, this.wasm.exports.getCameraMatrix(), 16);
    }
    this.cameraMatrix.set(camera.matrixWorldInverse.elements);

    // PERFORMANCE: Skip sorting when lights are animated
    // Morton ordering is only useful for static lights - with animated lights constantly moving,
    // the Morton order becomes stale immediately after sorting, making it pointless CPU overhead
    // Only sort once at initialization or when lights are added/removed
    // Also skip sorting if we have very few lights (no benefit, causes index corruption)
    const totalLights = this.pointLightCount + this.spotLightCount + this.rectLightCount;
    if (this.sortDeferred && !this.hasAnimatedLights && totalLights > 2) {
      this.wasm.exports.sort();
      this.sortDeferred = false;
    }

    // Always update lights - the WASM code handles fast paths internally
    const wasmStart = performance.now();
    this.hasAnimatedLights = this.wasm.exports.update(time) > 0;
    const wasmEnd = performance.now();

    // Track WASM CPU time
    this.wasmTimeValue += (wasmEnd - wasmStart);
    this.wasmTimeCount++;

    // Update display every 2 seconds
    if (time - this.wasmTimeLastUpdate > 2) {
      this.wasmTimeLastUpdate = time;
      if (this.wasmTimeEl) {
        this.wasmTimeEl.innerText = (this.wasmTimeValue / this.wasmTimeCount).toFixed(2);
      }
      this.wasmTimeCount = 0;
      this.wasmTimeValue = 0;
    }
    
    // Update texture data from WASM memory
    if (this.pointLightTexture.value && this.pointLightTextureData) {
      const pointCount = this.wasm.exports.getPointLightCount();
      if (pointCount > 0) {
        const actualFloats = pointCount * 2 * 4;
        const wasmDataPtr = this.wasm.exports.getPointLightTexture();

        if (wasmDataPtr % 4 !== 0) {
          console.error(`[ClusterLightingSystem] WASM pointer not aligned: ${wasmDataPtr}`);
        } else {
          // Check if we're using zero-copy mode
          const usingZeroCopy = this.pointLightTextureData.buffer === this.wasm.exports.memory.buffer;

          if (!usingZeroCopy) {
            // COPY MODE: Need to copy WASM data to texture buffer
            const wasmData = new Float32Array(
              this.wasm.exports.memory.buffer,
              wasmDataPtr,
              actualFloats
            );
            this.pointLightTextureData.set(wasmData);

            // Debug logging
            if (!this._loggedUpdate && pointCount > 0) {
              this._loggedUpdate = true;
            }
          } else {
            // ZERO-COPY MODE: Texture already references WASM memory
            // No copy needed! Just mark as needing GPU upload

            // Debug logging
            if (!this._loggedUpdate && pointCount > 0) {
              this._loggedUpdate = true;
            }
          }
        }
      }
      // Always mark texture for GPU upload since view-space positions change every frame
      // when the camera moves, regardless of whether lights are animated
      if (pointCount > 0) {
        this.pointLightTexture.value.needsUpdate = true;
      }
    }

    // Always update spot/rect textures since view-space positions change with camera movement
    if (this.spotLightTexture.value && this.spotLights.length > 0) {
      this.spotLightTexture.value.needsUpdate = true;
    }
    if (this.rectLightTexture.value && this.rectLights.length > 0) {
      this.rectLightTexture.value.needsUpdate = true;
    }


    this.updateProxyGeometry();

    const totalCount = this.pointLights.length + this.spotLights.length + this.rectLights.length;
    if (totalCount > 0) {
      this.renderTiles(time);
    }
  }

  renderTiles(time) {
    // Skip if no light textures are ready at all
    if (!this.pointLightTexture.value && !this.spotLightTexture.value && !this.rectLightTexture.value) {
      console.warn('[ClusterLightingSystem] Skipping renderTiles - no light textures initialized');
      return;
    }

    // Always render cluster tiles every frame for maximum responsiveness
    const currentFrame = this.renderer.info.render.frame;
    this.lastRenderFrame = currentFrame;
    this.lastClusterUpdateFrame = currentFrame;

    const oldRT = this.renderer.getRenderTarget();
    this.renderer.getClearColor(tempColor);
    const alpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(zeroColor, 0);

    // Start GPU timing for light assignment
    this.assignQuery.start();

    // Batch render target operations to reduce state changes
    const listRT = this.getListTarget();
    const masterRT = this.getMasterTarget();

    // First pass: light assignment
    this.renderer.setRenderTarget(listRT);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.listScene, this.camera);
    this.listTexture.value = listRT.texture;

    // Second pass: consolidation (no clear/restore in between)
    this.renderer.setRenderTarget(masterRT);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.tileScene, this.camera);
    this.masterTexture.value = masterRT.texture;

    // Optional third pass: super-master (8x8 reduction) for hierarchical early-out
    // DISABLED by default: 3rd render pass overhead > early-out savings at high light counts
    // With increased batch sizes (1024), we now have ~31 rows instead of 63, making
    // the super-master's 8x8 reduction less beneficial. Can be manually enabled via:
    // clusterLightingSystem.useSuperMaster = true
    const useSuper = this.useSuperMaster ?? false;
    
    if (useSuper) {
      const superRT = this.getSuperMasterTarget();
      
      // Create super-tiler mesh if it doesn't exist
      if (!this.superTiler) {
        this.superTiler = new Mesh(new FullscreenTriangleGeometry(), getSuperMasterMaterial());
        this.superTiler.frustumCulled = false;
        
        // Wire up uniforms to shared objects
        this.superTiler.material.uniforms.sliceParams = this.sliceParams;
        this.superTiler.material.uniforms.masterTexture = this.masterTexture;
        
        this.superTileScene = new Scene();
        this.superTileScene.add(this.superTiler);
      }
      
      // Render super-master
      this.renderer.setRenderTarget(superRT);
      this.renderer.clear(true, false, false);
      this.renderer.render(this.superTileScene, this.camera);
      this.superMasterTexture.value = superRT.texture;
    } else {
      this.superMasterTexture.value = null;
    }

    // Restore state once
    this.renderer.setRenderTarget(oldRT);
    this.renderer.setClearColor(tempColor, alpha);

    // Clear dirty flags after update
    this.clusterDirtyFlags.lightCountChanged = false;
    this.clusterDirtyFlags.lightPositionsChanged = false;
    this.clusterDirtyFlags.forceUpdate = false;

    // Always end GPU timing (even if skipped, so query object stays valid)
    this.assignQuery.end(time);
  }

  resize() {
    const bufferSize = new Vector2();
    this.renderer.getDrawingBufferSize(bufferSize);

    if (bufferSize.x > 0 && bufferSize.y > 0) {
      this.size.value = bufferSize;
      // MEMORY LEAK FIX: Dispose render targets before removing references
      if (this.masterTarget) {
        this.masterTarget.dispose();
        delete this.masterTarget;
      }
      if (this.listTarget) {
        this.listTarget.dispose();
        delete this.listTarget;
      }
      // REMOVED: superMasterTarget disposal (3rd render pass removed)
      this._computeClusterParams();
    }
  }

  getListTarget() {
    const tp = this.sliceParams.value;
    const requiredHeight = tp.y * this.batchCount.value;
    
    // Check if we need to recreate due to size change
    if (this.listTarget && this.listTarget.height !== requiredHeight) {
      this.listTarget.dispose();
      this.listTarget = null;
    }
    
    if (!this.listTarget) {
      this.listTarget = new WebGLRenderTarget(tp.x * tp.z, requiredHeight, {
        format: RGBAFormat,
        type: UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        generateMipmaps: false,
        samples: 0
      });
    }
    return this.listTarget;
  }

  getMasterTarget() {
    const tw = this.batchCount.value;
    const tp = this.sliceParams.value;
    const requiredHeight = tp.y * tp.w;

    // Determine the required type based on batch count
    const requiredType = tw > 16 ? UnsignedIntType : (tw > 8 ? UnsignedShortType : UnsignedByteType);

    // Check if we need to recreate due to size or type change

    // Check if we need to recreate due to size or type change
    if (this.masterTarget &&
      (this.masterTarget.height !== requiredHeight ||
       this.masterTarget.texture.type !== requiredType)) {
    this.masterTarget.dispose();
    this.masterTarget = null;
  }

  if (!this.masterTarget) {
    this.masterTarget = new WebGLRenderTarget(tp.x * tp.z, requiredHeight, {
      format: RedIntegerFormat,
      type: requiredType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      samples: 0,
      internalFormat: tw > 16 ? "R32UI" : (tw > 8 ? "R16UI" : "R8UI")
    });
  }
  return this.masterTarget;
}

getSuperMasterTarget() {
  const tp = this.sliceParams.value;
  const w = Math.ceil((tp.x * tp.z) / 8);
  const h = Math.ceil((tp.y * tp.w) / 8);
  
  // Determine required type based on batch count (same logic as master target)
  const tw = this.batchCount.value;
  const requiredType = tw > 16 ? UnsignedIntType : (tw > 8 ? UnsignedShortType : UnsignedByteType);
  
  // Check if we need to recreate due to size or type change
  if (this.superMasterTarget &&
      (this.superMasterTarget.width !== w || 
       this.superMasterTarget.height !== h ||
       this.superMasterTarget.texture.type !== requiredType)) {
    this.superMasterTarget.dispose();
    this.superMasterTarget = null;
  }
  
  if (!this.superMasterTarget) {
    const params = {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      samples: 0,
      format: RedIntegerFormat,
      type: requiredType,
      internalFormat: tw > 16 ? "R32UI" : (tw > 8 ? "R16UI" : "R8UI")
    };
    this.superMasterTarget = new WebGLRenderTarget(w, h, params);
  }
  
  return this.superMasterTarget;
}


dispose() {
  this.clearRenderTargets();
  
  if (this.pointLightTexture.value) {
    this.pointLightTexture.value.dispose();
    this.pointLightTexture.value = null;
  }
  if (this.spotLightTexture.value) {
    this.spotLightTexture.value.dispose();
    this.spotLightTexture.value = null;
  }
  if (this.rectLightTexture.value) {
    this.rectLightTexture.value.dispose();
    this.rectLightTexture.value = null;
  }
  if (this.proxy) {
    this.proxy.geometry.dispose();
    this.proxy.material.dispose();
  }
  if (this.tiler) {
    this.tiler.geometry.dispose();
    this.tiler.material.dispose();
  }
  if (this.superTiler) {
    this.superTiler.geometry.dispose();
    this.superTiler.material.dispose();
    this.superTiler = null;
  }
  if (this.superTileScene) {
    this.superTileScene = null;
  }

  // Clear scenes (remove children) - only if they have children to avoid warnings
  if (this.listScene && this.listScene.children.length > 0) {
    this.listScene.clear();
  }
  if (this.tileScene && this.tileScene.children.length > 0) {
    this.tileScene.clear();
  }
  // REMOVED: superTileScene cleanup (3rd render pass removed)

  this.renderer = null;
  this.wasm = null;
  this.cameraMatrix = null;
}
}

