// ShadowDemoScene.js - Demonstrates clustered shadow system with budget-based rendering
import { Vector3, Color, MeshStandardMaterial, Mesh, BoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, MathUtils } from 'three';
import { BaseScene } from './BaseScene.js';
import { PulseTarget } from '../../lib/index.js';

export class ShadowDemoScene extends BaseScene {
  constructor(renderer, lightsSystem) {
    super(renderer, lightsSystem, {
      cameraPosition: new Vector3(18, 22, 22),
      controlsTarget: new Vector3(0, 2, 0),
      maxDistance: 80,
      minDistance: 5,
      showLightMarkers: true,
      showGlow: true,
      pointGlowRadius: 0.4,
      spotGlowRadius: 0.5,
    });

    this.params = {
      shadowMode: 'atlas',  // 'off', 'atlas', 'screenspace'
      shadowBudget: 8,
      shadowsPerFrame: 4,
      shadowIntensity: 0.7,
      showShadowCasters: true,
    };

    this.shadowStats = {
      activeShadows: 0,
      cacheSize: 0,
    };

    this.mainFolder = null;
    this.statsBindings = [];

    // Animated shadow light indices
    this._animLights = [];
  }

  getSceneInfo() {
    return {
      title: 'Shadow Demo',
      content: `
        <p>Demonstrates the clustered shadow system with budget-based temporal rendering.
        Only the most important lights cast shadows each frame.</p>

        <h3>Shadow Budget System</h3>
        <ul>
          <li><strong>Budget</strong> - Max lights that cast shadows simultaneously</li>
          <li><strong>Per Frame</strong> - Max shadow maps re-rendered per frame</li>
          <li><strong>Temporal Cache</strong> - Shadow maps reused across frames</li>
          <li><strong>Importance</strong> - Closer + larger + brighter = higher priority</li>
        </ul>

        <h3>Controls</h3>
        <ul>
          <li>Toggle shadows on/off</li>
          <li>Adjust shadow budget and per-frame limit</li>
          <li>Control shadow intensity per light</li>
        </ul>
      `
    };
  }

  getStatsBindings() {
    return [
      { object: this.shadowStats, property: 'activeShadows', label: 'Active Shadows' },
      { object: this.shadowStats, property: 'cacheSize', label: 'Cache Size' },
    ];
  }

  init() {
    // Floor
    const groundGeometry = new PlaneGeometry(60, 60);
    const groundMaterial = new MeshStandardMaterial({ color: 0x303030, roughness: 0.8 });
    const ground = new Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Shadow-receiving objects scattered around the scene
    const objectConfigs = [
      // Central pedestal with sphere
      { type: 'box', args: [2, 0.5, 2], pos: [0, 0.25, 0], color: 0x808080 },
      { type: 'sphere', args: [1.2], pos: [0, 1.7, 0], color: 0xdddddd, roughness: 0.2, metalness: 0.8 },

      // Columns that cast and receive shadows
      { type: 'cylinder', args: [0.5, 0.5, 6, 16], pos: [-6, 3, -6], color: 0xc0c0c0 },
      { type: 'cylinder', args: [0.5, 0.5, 6, 16], pos: [6, 3, -6], color: 0xc0c0c0 },
      { type: 'cylinder', args: [0.5, 0.5, 6, 16], pos: [-6, 3, 6], color: 0xc0c0c0 },
      { type: 'cylinder', args: [0.5, 0.5, 6, 16], pos: [6, 3, 6], color: 0xc0c0c0 },

      // Boxes at various positions
      { type: 'box', args: [2, 3, 2], pos: [-10, 1.5, 0], color: 0xff6b6b, roughness: 0.5 },
      { type: 'box', args: [1.5, 2, 3], pos: [10, 1, -5], color: 0x4ecdc4, roughness: 0.4 },
      { type: 'box', args: [3, 1.5, 1.5], pos: [0, 0.75, -10], color: 0xffe66d, roughness: 0.6 },

      // Spheres
      { type: 'sphere', args: [1], pos: [-4, 1, 4], color: 0x95e1d3, roughness: 0.3, metalness: 0.5 },
      { type: 'sphere', args: [0.8], pos: [4, 0.8, 8], color: 0xf38181, roughness: 0.4 },
      { type: 'sphere', args: [1.5], pos: [8, 1.5, 4], color: 0xaa96da, roughness: 0.2, metalness: 0.7 },

      // Back wall
      { type: 'box', args: [30, 10, 0.5], pos: [0, 5, -15], color: 0xf0f0f0 },
    ];

    objectConfigs.forEach(cfg => {
      let geometry;
      if (cfg.type === 'box') geometry = new BoxGeometry(...cfg.args);
      else if (cfg.type === 'sphere') geometry = new SphereGeometry(...cfg.args);
      else if (cfg.type === 'cylinder') geometry = new CylinderGeometry(...cfg.args);

      const material = new MeshStandardMaterial({
        color: cfg.color,
        roughness: cfg.roughness ?? 0.7,
        metalness: cfg.metalness ?? 0.1,
      });

      const mesh = new Mesh(geometry, material);
      mesh.position.set(...cfg.pos);
      this.scene.add(mesh);
    });
  }

  initLights() {
    this.lightsSystem.clearLights();

    // Enable shadows on the system
    this.lightsSystem.setShadowMode(this.params.shadowMode);
    this.lightsSystem.setShadowBudget(this.params.shadowBudget, this.params.shadowsPerFrame);

    // === Shadow-casting lights (orbiting key lights) ===
    this._animLights = [];

    // Orbiting warm light
    const keyLight1 = this.lightsSystem.addLight({
      type: 'point',
      position: new Vector3(-8, 10, -4),
      color: new Color(1, 0.85, 0.6),
      intensity: 25,
      radius: 22,
      decay: 2,
    });
    this.lightsSystem.setLightShadow('point', keyLight1, true, this.params.shadowIntensity);
    this._animLights.push({ type: 'point', idx: keyLight1, radius: 10, height: 10, speed: 0.4, phase: 0 });

    // Orbiting cool light (opposite direction)
    const keyLight2 = this.lightsSystem.addLight({
      type: 'point',
      position: new Vector3(8, 12, 4),
      color: new Color(0.6, 0.8, 1),
      intensity: 20,
      radius: 22,
      decay: 2,
    });
    this.lightsSystem.setLightShadow('point', keyLight2, true, this.params.shadowIntensity);
    this._animLights.push({ type: 'point', idx: keyLight2, radius: 12, height: 11, speed: -0.3, phase: Math.PI });

    // Orbiting green light (lower, tighter orbit)
    const keyLight3 = this.lightsSystem.addLight({
      type: 'point',
      position: new Vector3(0, 6, 8),
      color: new Color(0.4, 1, 0.6),
      intensity: 18,
      radius: 18,
      decay: 2,
    });
    this.lightsSystem.setLightShadow('point', keyLight3, true, this.params.shadowIntensity);
    this._animLights.push({ type: 'point', idx: keyLight3, radius: 7, height: 5, speed: 0.5, phase: Math.PI * 0.6 });

    // Orbiting magenta light
    const keyLight4 = this.lightsSystem.addLight({
      type: 'point',
      position: new Vector3(-5, 8, 5),
      color: new Color(1, 0.4, 0.8),
      intensity: 22,
      radius: 20,
      decay: 2,
    });
    this.lightsSystem.setLightShadow('point', keyLight4, true, this.params.shadowIntensity);
    this._animLights.push({ type: 'point', idx: keyLight4, radius: 9, height: 8, speed: -0.25, phase: Math.PI * 1.3 });

    // === Non-shadow fill lights (ambient fill, no shadows) ===

    // Subtle fill lights around the scene (these won't cast shadows)
    const fillLights = [
      { pos: new Vector3(-15, 3, 0), color: new Color(0.4, 0.3, 0.6), intensity: 8, radius: 15 },
      { pos: new Vector3(15, 3, 0), color: new Color(0.6, 0.4, 0.3), intensity: 8, radius: 15 },
      { pos: new Vector3(0, 2, 12), color: new Color(0.3, 0.5, 0.4), intensity: 6, radius: 12 },
      { pos: new Vector3(0, 2, -12), color: new Color(0.5, 0.3, 0.5), intensity: 6, radius: 12 },
    ];

    fillLights.forEach(fl => {
      this.lightsSystem.addLight({
        type: 'point',
        position: fl.pos,
        color: fl.color,
        intensity: fl.intensity,
        radius: fl.radius,
        decay: 2,
      });
    });

    // Animated accent lights (non-shadow, for visual interest)
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const r = 10;
      this.lightsSystem.addLight({
        type: 'point',
        position: new Vector3(Math.cos(angle) * r, 1, Math.sin(angle) * r),
        color: new Color().setHSL(i / 6, 0.7, 0.5),
        intensity: 5,
        radius: 8,
        decay: 2,
        animation: {
          pulse: { speed: 1 + i * 0.3, amount: 0.4, target: PulseTarget.INTENSITY }
        }
      });
    }

    // Reinit light markers
    if (this.lightMarkers) {
      requestAnimationFrame(() => {
        if (this.active && this.lightMarkers) {
          this.lightMarkers.init(this.scene);
        }
      });
    }
  }

  update(time) {
    // Animate orbiting shadow lights (guard against cleared/removed lights)
    if (this._animLights.length > 0) {
      const wasm = this.lightsSystem.wasm.exports;
      const pointLights = this.lightsSystem.pointLights;
      for (const light of this._animLights) {
        if (light.type === 'point' && light.idx < pointLights.length) {
          const angle = time * light.speed + light.phase;
          const x = Math.cos(angle) * light.radius;
          const z = Math.sin(angle) * light.radius;
          const y = light.height + Math.sin(time * light.speed * 2 + light.phase) * 1.5;

          wasm.updatePointLightPosition(light.idx, x, y, z);
          pointLights[light.idx].position.set(x, y, z);
        }
      }
      this.lightsSystem.clusterDirtyFlags.lightPositionsChanged = true;
      this.lightsSystem.lightsDirty = true;
    }

    // Update shadow stats for UI
    if (this.lightsSystem.shadowAtlas) {
      const stats = this.lightsSystem.getShadowStats();
      this.shadowStats.activeShadows = stats.activeCandidates;
      this.shadowStats.cacheSize = stats.cacheSize;
    }
  }

  createUI(pane) {
    const folder = pane.addFolder({ title: 'Shadow Demo', expanded: true });
    this.mainFolder = folder;

    // Shadow controls
    const shadowFolder = folder.addFolder({ title: 'Shadows', expanded: true });

    shadowFolder.addBinding(this.params, 'shadowMode', {
      label: 'Mode',
      options: { Off: 'off', Atlas: 'atlas', 'Screen-Space': 'screenspace' }
    }).on('change', (ev) => {
      this.lightsSystem.setShadowMode(ev.value);
    });

    shadowFolder.addBinding(this.params, 'shadowBudget', {
      label: 'Max Shadow Lights',
      min: 1,
      max: 88,
      step: 1
    }).on('change', (ev) => {
      this.lightsSystem.setShadowBudget(ev.value, undefined);
    });

    shadowFolder.addBinding(this.params, 'shadowsPerFrame', {
      label: 'Renders/Frame',
      min: 1,
      max: 16,
      step: 1
    }).on('change', (ev) => {
      this.lightsSystem.setShadowBudget(undefined, ev.value);
    });

    shadowFolder.addBinding(this.params, 'shadowIntensity', {
      label: 'Shadow Darkness',
      min: 0,
      max: 1,
      step: 0.05
    }).on('change', (ev) => {
      // Update all shadow-casting lights via the public API (works with JS fallback)
      const flags = this.lightsSystem._shadowFlags;
      for (let i = 0; i < this.lightsSystem.pointLights.length; i++) {
        if (flags.point[i]?.castsShadow) {
          this.lightsSystem.setLightShadow('point', i, true, ev.value);
        }
      }
      for (let i = 0; i < this.lightsSystem.spotLights.length; i++) {
        if (flags.spot[i]?.castsShadow) {
          this.lightsSystem.setLightShadow('spot', i, true, ev.value);
        }
      }
    });

    folder.addBlade({ view: 'separator' });

    // Stats
    const statsFolder = folder.addFolder({ title: 'Shadow Stats', expanded: true });
    const activeBind = statsFolder.addBinding(this.shadowStats, 'activeShadows', { label: 'Active', readonly: true });
    const cacheBind = statsFolder.addBinding(this.shadowStats, 'cacheSize', { label: 'Cached', readonly: true });

    this._statsInterval = setInterval(() => {
      if (this.active) {
        activeBind.refresh();
        cacheBind.refresh();
      }
    }, 500);

    folder.addBlade({ view: 'separator' });

    // Presets
    folder.addButton({ title: 'Add Shadow Light' }).on('click', () => {
      const pos = new Vector3(
        MathUtils.randFloatSpread(16),
        MathUtils.randFloat(6, 14),
        MathUtils.randFloatSpread(16)
      );
      const idx = this.lightsSystem.addLight({
        type: 'point',
        position: pos,
        color: new Color().setHSL(Math.random(), 0.7, 0.5),
        intensity: MathUtils.randFloat(15, 30),
        radius: MathUtils.randFloat(12, 20),
        decay: 2,
      });
      this.lightsSystem.setLightShadow('point', idx, true, this.params.shadowIntensity);

      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }
    });

    folder.addButton({ title: 'Add Fill Light (no shadow)' }).on('click', () => {
      this.lightsSystem.addLight({
        type: 'point',
        position: new Vector3(
          MathUtils.randFloatSpread(20),
          MathUtils.randFloat(1, 4),
          MathUtils.randFloatSpread(20)
        ),
        color: new Color().setHSL(Math.random(), 0.5, 0.5),
        intensity: MathUtils.randFloat(3, 8),
        radius: MathUtils.randFloat(8, 14),
        decay: 2,
      });

      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }
    });

    folder.addButton({ title: 'Clear All Lights' }).on('click', () => {
      this._animLights = [];
      this.lightsSystem.clearLights();
      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }
    });
  }

  dispose() {
    if (this._statsInterval) {
      clearInterval(this._statsInterval);
      this._statsInterval = null;
    }
    super.dispose();
  }
}
