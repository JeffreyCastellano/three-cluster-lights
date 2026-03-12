// shadow-atlas.js - Variable-resolution virtual shadow atlas with temporal caching
// Manages a shared atlas texture where each shadow-casting light gets a tile.
// Tile sizes vary by importance: 512px (close/bright), 256px (medium), 128px (distant).
// Shadow data is stored in a DataTexture (no uniform array limit).
// Only a budget of N shadows are re-rendered per frame to maintain performance.

import {
  WebGLRenderTarget,
  DepthTexture,
  NearestFilter,
  UnsignedIntType,
  DepthFormat,
  FloatType,
  RGBAFormat,
  PerspectiveCamera,
  Vector3,
  Vector4,
  Matrix4,
  DataTexture,
  MeshDepthMaterial,
  RGBADepthPacking,
  NoBlending
} from 'three';

// Reusable temporaries
const _lightWorldPos = new Vector3();
const _target = new Vector3();
const _savedViewport = new Vector4();
const _savedScissor = new Vector4();
const _tempMatrix = new Matrix4();

// Atlas layout: 3 resolution tiers packed into a 2048×2048 atlas
// Zone 0 (high):  rows 0-1023    → 512px tiles, 4 cols × 2 rows =  8 slots
// Zone 1 (med):   rows 1024-1535 → 256px tiles, 8 cols × 2 rows = 16 slots
// Zone 2 (low):   rows 1536-2047 → 128px tiles, 16 cols × 4 rows = 64 slots
// Total: 88 shadow casters in a single 2048×2048 atlas

const TIER_CONFIG = [
  { size: 512, yOffset: 0,    rows: 2, cols: 4  },  //  8 slots
  { size: 256, yOffset: 1024, rows: 2, cols: 8  },  // 16 slots
  { size: 128, yOffset: 1536, rows: 4, cols: 16 },  // 64 slots
];

const MAX_SHADOW_CANDIDATES = 88;

// Data texture layout: width=6, height=MAX_SHADOW_CANDIDATES, RGBA Float32
// Row i = candidate i:
//   texel(0,i) = vec4(type, typeIndex, shadowIntensity, 0)
//   texel(1,i) = vec4(atlasU, atlasV, tileUV, shadowBias)
//   texel(2,i) = mat4 column 0
//   texel(3,i) = mat4 column 1
//   texel(4,i) = mat4 column 2
//   texel(5,i) = mat4 column 3
const DATA_TEX_WIDTH = 6;

export class ShadowAtlas {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.atlasSize = options.atlasSize || 2048;
    this.shadowsPerFrame = options.shadowsPerFrame || 4;
    this.shadowBias = options.shadowBias || 0.005;
    this.enabled = options.enabled ?? false;

    // Atlas render target with depth
    this.atlasTarget = new WebGLRenderTarget(this.atlasSize, this.atlasSize);
    this.atlasTarget.depthTexture = new DepthTexture(this.atlasSize, this.atlasSize);
    this.atlasTarget.depthTexture.type = UnsignedIntType;
    this.atlasTarget.depthTexture.format = DepthFormat;

    // Depth material for shadow rendering
    this.depthMaterial = new MeshDepthMaterial({
      depthPacking: RGBADepthPacking,
      blending: NoBlending
    });

    // Shadow camera (reused per light)
    this.shadowCamera = new PerspectiveCamera(90, 1, 0.5, 500);

    // Build slot table from tier config
    this.slots = [];  // { tier, localIndex, x, y, size, key, lastFrame }
    for (let t = 0; t < TIER_CONFIG.length; t++) {
      const tier = TIER_CONFIG[t];
      for (let r = 0; r < tier.rows; r++) {
        for (let c = 0; c < tier.cols; c++) {
          this.slots.push({
            tier: t,
            x: c * tier.size,
            y: tier.yOffset + r * tier.size,
            size: tier.size,
            key: null,
            lastFrame: 0
          });
        }
      }
    }

    this.frameCount = 0;

    // Temporal cache: "type-index" → { slotIdx, lastFrame, shadowMatrix }
    this.candidateCache = new Map();

    // Shadow data texture (replaces uniform arrays — no size limit)
    this.dataTexArray = new Float32Array(DATA_TEX_WIDTH * MAX_SHADOW_CANDIDATES * 4);
    this.dataTexture = new DataTexture(
      this.dataTexArray,
      DATA_TEX_WIDTH,
      MAX_SHADOW_CANDIDATES,
      RGBAFormat,
      FloatType
    );
    this.dataTexture.minFilter = NearestFilter;
    this.dataTexture.magFilter = NearestFilter;
    this.dataTexture.generateMipmaps = false;

    // Reusable matrix for shadow computation
    this._shadowMatrix = new Matrix4();
    this.activeCandidateCount = 0;
  }

  /**
   * Update shadow atlas for current frame
   * @param {object} wasm - WASM exports
   * @param {Scene} scene - Scene to render shadows for
   * @param {Camera} camera - Main camera (for inverse view transform)
   * @param {number} candidateCount - Number from WASM selectShadowLights()
   * @returns {number} Number of active shadow candidates
   */
  update(wasm, scene, camera, candidateCount) {
    if (!this.enabled || candidateCount === 0) {
      this.activeCandidateCount = 0;
      return 0;
    }

    this.frameCount++;
    let renderedThisFrame = 0;

    const inverseViewMatrix = camera.matrixWorld;

    // Build candidate list with importance scores for tier assignment
    const candidates = [];
    for (let i = 0; i < candidateCount; i++) {
      const type = wasm.getShadowCandidateType(i);
      const index = wasm.getShadowCandidateIndex(i);
      const importance = wasm.getShadowCandidateImportance(i);
      const key = `${type}-${index}`;

      candidates.push({
        type, index, key, importance, wasmIdx: i,
        viewX: wasm.getShadowCandidateViewX(i),
        viewY: wasm.getShadowCandidateViewY(i),
        viewZ: wasm.getShadowCandidateViewZ(i),
        radius: wasm.getShadowCandidateRadius(i)
      });

      // Check temporal cache — reuse if recently rendered
      const cached = this.candidateCache.get(key);
      if (cached && (this.frameCount - cached.lastFrame) < 4) {
        wasm.setShadowStale(i, 0);
      } else {
        wasm.setShadowStale(i, 1);
      }
    }

    // Assign tier based on importance ranking
    // Candidates are already sorted by importance from WASM
    for (let i = 0; i < candidates.length; i++) {
      candidates[i].tier = this._getTier(i, candidates.length);
    }

    // Burst fill: if cache is cold (>half stale), render all. Otherwise budget-limit.
    let staleCount = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (wasm.isShadowStale(i)) staleCount++;
    }
    const budget = (staleCount > candidates.length * 0.5)
      ? candidates.length  // Burst: render all
      : this.shadowsPerFrame;

    const oldRT = this.renderer.getRenderTarget();
    const oldOverride = scene.overrideMaterial;
    this.renderer.getViewport(_savedViewport);
    this.renderer.getScissor(_savedScissor);
    const oldScissorTest = this.renderer.getScissorTest();

    try {
      for (let i = 0; i < candidates.length && renderedThisFrame < budget; i++) {
        if (!wasm.isShadowStale(i)) continue;

        const c = candidates[i];
        const slotIdx = this._allocateSlot(c.key, c.tier);
        if (slotIdx < 0) continue; // Atlas full for this tier

        const slot = this.slots[slotIdx];

        // Convert view-space position to world-space
        _lightWorldPos.set(c.viewX, c.viewY, c.viewZ);
        _lightWorldPos.applyMatrix4(inverseViewMatrix);

        // Configure shadow camera
        this._configureShadowCamera(c, _lightWorldPos, wasm);

        // Compute camera-independent shadow matrix: shadowProj * shadowView
        // (camera.matrixWorld is applied per-frame in _buildDataTexture)
        const shadowMatrix = this._shadowMatrix;
        shadowMatrix.copy(this.shadowCamera.projectionMatrix);
        shadowMatrix.multiply(this.shadowCamera.matrixWorldInverse);

        // Render to atlas tile
        this.renderer.setRenderTarget(this.atlasTarget);
        scene.overrideMaterial = this.depthMaterial;

        this.renderer.setScissorTest(true);
        this.renderer.setScissor(slot.x, slot.y, slot.size, slot.size);
        this.renderer.setViewport(slot.x, slot.y, slot.size, slot.size);

        this.renderer.clearDepth();
        this.renderer.render(scene, this.shadowCamera);

        this.candidateCache.set(c.key, {
          slotIdx,
          lastFrame: this.frameCount,
          shadowMatrix: shadowMatrix.clone()
        });

        wasm.setShadowStale(i, 0);
        renderedThisFrame++;
      }
    } finally {
      // Restore renderer state — render target FIRST (Three.js may reset viewport on setRenderTarget)
      scene.overrideMaterial = oldOverride;
      this.renderer.setRenderTarget(oldRT);
      this.renderer.setScissorTest(oldScissorTest);
      this.renderer.setScissor(_savedScissor);
      this.renderer.setViewport(_savedViewport);
    }

    // Build data texture for shader (pass camera for per-frame matrix rebuild)
    this._buildDataTexture(candidates, wasm, camera);

    // Evict old cache entries
    for (const [key, val] of this.candidateCache) {
      if (this.frameCount - val.lastFrame > 10) {
        this.slots[val.slotIdx].key = null;
        this.candidateCache.delete(key);
      }
    }

    return this.activeCandidateCount;
  }

  _getTier(rank, totalCandidates) {
    // Top candidates get high-res tiles, rest get progressively lower
    const tierSizes = [
      TIER_CONFIG[0].rows * TIER_CONFIG[0].cols,  // 8
      TIER_CONFIG[1].rows * TIER_CONFIG[1].cols,  // 16
      TIER_CONFIG[2].rows * TIER_CONFIG[2].cols,  // 64
    ];
    if (rank < tierSizes[0]) return 0;
    if (rank < tierSizes[0] + tierSizes[1]) return 1;
    return 2;
  }

  _buildDataTexture(candidates, wasm, camera) {
    const data = this.dataTexArray;
    const atlasInv = 1.0 / this.atlasSize;
    data.fill(0);

    this.activeCandidateCount = 0;

    for (let i = 0; i < candidates.length && this.activeCandidateCount < MAX_SHADOW_CANDIDATES; i++) {
      const c = candidates[i];
      const cached = this.candidateCache.get(c.key);
      const ci = this.activeCandidateCount;
      const rowOffset = ci * DATA_TEX_WIDTH * 4; // 4 floats per texel, DATA_TEX_WIDTH texels per row

      // Texel 0: info — type, typeIndex, shadowIntensity, hasAtlas
      // hasAtlas (w): 1.0 = use atlas shadow, 0.0 = use screen-space fallback
      let shadowIntensity = 0.5;
      if (c.type === 0) shadowIntensity = wasm.getPointLightShadowIntensity(c.index);
      else if (c.type === 1) shadowIntensity = wasm.getSpotLightShadowIntensity(c.index);
      else if (c.type === 2) shadowIntensity = wasm.getRectLightShadowIntensity(c.index);

      data[rowOffset + 0] = c.type;
      data[rowOffset + 1] = c.index;
      data[rowOffset + 2] = shadowIntensity;

      if (cached) {
        // Has atlas data — write full shadow info
        data[rowOffset + 3] = 1.0; // hasAtlas flag

        const slot = this.slots[cached.slotIdx];

        // Texel 1: atlas UV — atlasU, atlasV, tileUV, shadowBias
        data[rowOffset + 4] = slot.x * atlasInv;
        data[rowOffset + 5] = slot.y * atlasInv;
        data[rowOffset + 6] = slot.size * atlasInv;
        data[rowOffset + 7] = this.shadowBias;

        // Texels 2-5: full shadow matrix rebuilt each frame
        _tempMatrix.copy(cached.shadowMatrix);
        _tempMatrix.multiply(camera.matrixWorld);
        const mat = _tempMatrix.elements;
        for (let j = 0; j < 16; j++) {
          data[rowOffset + 8 + j] = mat[j];
        }
      } else {
        // No atlas data yet — shader will use screen-space fallback
        data[rowOffset + 3] = 0.0; // no atlas
      }

      this.activeCandidateCount++;
    }

    this.dataTexture.needsUpdate = true;
  }

  _configureShadowCamera(candidate, worldPos, wasm) {
    const cam = this.shadowCamera;
    cam.near = 0.2;
    cam.far = Math.max(candidate.radius * 1.5, 10);
    cam.fov = 120; // Wide FOV to cover more shadow area per light
    cam.position.copy(worldPos);

    // Always look downward — ground plane is the primary shadow receiver
    _target.copy(worldPos);
    _target.y -= candidate.radius;

    cam.lookAt(_target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
  }

  _allocateSlot(key, tier) {
    // Reuse existing slot
    const existing = this.candidateCache.get(key);
    if (existing) return existing.slotIdx;

    // Find empty slot in requested tier (or fall back to lower tier)
    for (let t = tier; t < TIER_CONFIG.length; t++) {
      for (let i = 0; i < this.slots.length; i++) {
        if (this.slots[i].tier === t && !this.slots[i].key) {
          this.slots[i].key = key;
          this.slots[i].lastFrame = this.frameCount;
          return i;
        }
      }
    }

    // Evict oldest slot in any tier (prefer same or lower tier)
    let oldestIdx = -1;
    let oldestFrame = Infinity;
    for (let t = tier; t < TIER_CONFIG.length; t++) {
      for (let i = 0; i < this.slots.length; i++) {
        if (this.slots[i].tier === t && this.slots[i].lastFrame < oldestFrame) {
          oldestFrame = this.slots[i].lastFrame;
          oldestIdx = i;
        }
      }
      if (oldestIdx >= 0) break;
    }

    // Fall back to evicting from higher tiers if needed
    if (oldestIdx < 0) {
      for (let i = 0; i < this.slots.length; i++) {
        if (this.slots[i].lastFrame < oldestFrame) {
          oldestFrame = this.slots[i].lastFrame;
          oldestIdx = i;
        }
      }
    }

    if (oldestIdx >= 0) {
      if (this.slots[oldestIdx].key) {
        this.candidateCache.delete(this.slots[oldestIdx].key);
      }
      this.slots[oldestIdx].key = key;
      this.slots[oldestIdx].lastFrame = this.frameCount;
      return oldestIdx;
    }

    return -1;
  }

  getStats() {
    let usedSlots = 0;
    const tierUsed = [0, 0, 0];
    for (const slot of this.slots) {
      if (slot.key) {
        usedSlots++;
        tierUsed[slot.tier]++;
      }
    }
    return {
      enabled: this.enabled,
      activeCandidates: this.activeCandidateCount,
      cacheSize: this.candidateCache.size,
      atlasSize: this.atlasSize,
      maxSlots: this.slots.length,
      usedSlots,
      tierUsed,
      tierSizes: TIER_CONFIG.map(t => t.size),
      shadowsPerFrame: this.shadowsPerFrame
    };
  }

  dispose() {
    this.atlasTarget.dispose();
    if (this.atlasTarget.depthTexture) {
      this.atlasTarget.depthTexture.dispose();
    }
    this.depthMaterial.dispose();
    this.dataTexture.dispose();
    this.candidateCache.clear();
    for (const slot of this.slots) slot.key = null;
  }
}
