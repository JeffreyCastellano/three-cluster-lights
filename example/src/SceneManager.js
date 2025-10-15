// SceneManager.js - Manages multiple scenes and tab switching
import { Pane } from 'tweakpane';
import { PMREMGenerator, NoToneMapping, LinearToneMapping, ReinhardToneMapping, CineonToneMapping, ACESFilmicToneMapping } from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { applyTheme } from 'tweakpane-draggable-theme';
import { ClusterLightingSystem, GPUQuery, loadWasm, AdaptiveTileSpan } from '../lib/index.js';
import { BasicExampleScene } from './scenes/BasicExampleScene.js';
import { LightPlaygroundScene } from './scenes/LightPlaygroundScene.js';
import { LightTypesScene } from './scenes/LightTypesScene.js';
import { StressTest2DScene } from './scenes/StressTest2DScene.js';
import { StressTest3DScene } from './scenes/StressTest3DScene.js';
import { LightPhysicsScene } from './scenes/LightPhysicsScene.js';

export class SceneManager {
  constructor(container, renderer, cpuTracker = null) {
    this.container = container;
    this.renderer = renderer;
    this.cpuTracker = cpuTracker;
    this.scenes = {};
    this.currentScene = null;
    this.pane = null;

    this.wasmModule = null;
    this.wasmReady = false;
    this.sharedClusterLightingSystem = null;

    // Performance tracking
    this.shadeQuery = null;
    this.clock = null;
    this.gpuTotalTracker = null;

    // Environment map
    this.environmentMap = null;

    // Setup scene info modal
    this.setupSceneInfoModal();
  }

  async init() {
    // Load WASM using the library's helper (handles SIMD detection automatically)
    try {
      this.wasmModule = await loadWasm();
      this.wasmReady = true;

      // Detect which implementation is running
      // Fallback has a custom class, WASM has WebAssembly.Instance
      const isFallback = this.wasmModule.instance.exports.constructor?.name === 'FallbackLightingSystem';

      if (isFallback) {
        console.warn('[SceneManager] Running in fallback mode - performance will be reduced. Recommended max: 8k lights');
      }

      // Hide loading
      const loading = document.getElementById('loading');
      if (loading) loading.style.display = 'none';

      // Create shared lights system
      // Optimized cluster resolution: 24×12×24 = 6,912 clusters (vs 16,384)
      // Reduces GPU memory and assignment cost while maintaining quality
      this.sharedClusterLightingSystem = new ClusterLightingSystem(
        this.renderer,
        this.wasmModule,
        0.1,
        4000,  // Large far plane to support zoomed-out views
        32, 16, 32,
        //24 × 12 × 24
        // 32, 16, 32
        true // performance mode
      );
      // Disable super-master by default (3rd render pass overhead > early-out savings)
      this.sharedClusterLightingSystem.useSuperMaster = true;
      this.sharedClusterLightingSystem.resize();

      // Get reference to assign query for GPU total calculation
      if (this.sharedClusterLightingSystem.assignQuery) {
        this.assignQuery = this.sharedClusterLightingSystem.assignQuery;
      }

      // Create adaptive performance tuning system
      this.adaptiveTileSpan = new AdaptiveTileSpan(this.sharedClusterLightingSystem, {
        targetFPS: 90,
        minTileSpan: 6,   // Don't go below 8 to avoid tile boundary artifacts
        maxTileSpan: 16,
        enabled: true,
        adjustmentRate: 0.5,
        updateInterval: 500,
        fpsMarginLow: 0.92,
        fpsMarginHigh: 1.05
      });


      // Initialize performance tracking
      this.shadeQuery = new GPUQuery(this.renderer, "#perf-shade-value");
      this.clock = { startTime: performance.now() };

      // Create GPU total tracker (calculates assign + shade)
      this.gpuTotalTracker = {
        el: document.querySelector("#perf-gpu-value"),
        assignQuery: null,
        shadeQuery: this.shadeQuery
      };

      // Create scenes
      this.createScenes();

      // Load and apply environment map (HDR) once for all scenes
      //this.loadEnvironmentMap();

      // Create UI
      this.createUI();

      // Setup URL hash routing
      this.setupURLRouting();

      // Show initial scene (from URL hash or default to basicExample)
      const initialScene = this.getSceneFromURL() || 'basicExample';
      this.switchScene(initialScene);

    } catch (error) {
      console.error('Failed to load WASM:', error);
      const loading = document.getElementById('loading');
      if (loading) {
        loading.textContent = 'Error loading WASM: ' + error.message;
        loading.style.color = '#ff5555';
      }
    }
  }

  createScenes() {
    // Pass the shared lights system to all scenes
    this.scenes = {
      basicExample: new BasicExampleScene(this.renderer, this.sharedClusterLightingSystem),
      lightPlayground: new LightPlaygroundScene(this.renderer, this.sharedClusterLightingSystem),
      lightPhysics: new LightPhysicsScene(this.renderer, this.sharedClusterLightingSystem),
      types: new LightTypesScene(this.renderer, this.sharedClusterLightingSystem),
      stressTest2D: new StressTest2DScene(this.renderer, this.sharedClusterLightingSystem),
      stressTest3D: new StressTest3DScene(this.renderer, this.sharedClusterLightingSystem),
    };

    // Initialize all scenes and pass shadeQuery
    Object.values(this.scenes).forEach(scene => {
      scene.shadeQuery = this.shadeQuery;
      scene.init();
    });
  }

  createUI() {
    // Create main Tweakpane (right side)
    this.pane = new Pane({
      expanded: true,
      container: document.getElementById('tweakpane-container') || document.body
    });
    const api = applyTheme(this.pane, { draggable: true, title: 'Controls' });

    // Scene selector
    this.sceneParams = { scene: 'basicExample' };

    this.sceneSelector = this.pane.addBlade({
      view: 'list',
      label: 'Scene',
      options: [
        { text: '🔲 Basic Example', value: 'basicExample' },
        { text: '✨ Light Playground', value: 'lightPlayground' },
        { text: '🎱 Light Physics', value: 'lightPhysics' },
        { text: '💡 Light Types', value: 'types' },
        { text: '⚡ 2D Stress Test', value: 'stressTest2D' },
        { text: '🧊 3D Stress Test', value: 'stressTest3D' },
      ],
      value: this.sceneParams.scene
    }).on('change', (ev) => {
      this.switchScene(ev.value);
    });

    // Renderer tonemapping controls
    let tmDefault = 'ACES';
    switch (this.renderer?.toneMapping) {
      case NoToneMapping: tmDefault = 'None'; break;
      case LinearToneMapping: tmDefault = 'Linear'; break;
      case ReinhardToneMapping: tmDefault = 'Reinhard'; break;
      case CineonToneMapping: tmDefault = 'Cineon'; break;
      case ACESFilmicToneMapping: default: tmDefault = 'ACES'; break;
    }
    this.renderParams = {
      tonemap: tmDefault,
      exposure: this.renderer?.toneMappingExposure ?? 0.5,
      pixelRatio: this.renderer?.getPixelRatio() ?? 1.0
    };

    // Adaptive Performance controls
    this.perfParams = {
      enabled: this.adaptiveTileSpan.enabled,
      targetFPS: this.adaptiveTileSpan.targetFPS,
      minTileSpan: this.adaptiveTileSpan.minTileSpan,
      maxTileSpan: this.adaptiveTileSpan.maxTileSpan,
      currentTileSpan: this.adaptiveTileSpan.lightsSystem.getMaxTileSpan(),
      averageFPS: 60
    };

    // General folder - combines render and cluster performance settings
    const generalFolder = this.pane.addFolder({ title: 'General', expanded: false });

    // Render settings
    generalFolder.addBlade({
      view: 'list',
      label: 'Tone Mapping',
      options: [
        { text: 'None', value: 'None' },
        { text: 'Linear', value: 'Linear' },
        { text: 'Reinhard', value: 'Reinhard' },
        { text: 'Cineon', value: 'Cineon' },
        { text: 'ACES', value: 'ACES' },
      ],
      value: this.renderParams.tonemap
    }).on('change', (ev) => {
      this.renderParams.tonemap = ev.value;
      switch (ev.value) {
        case 'None': this.renderer.toneMapping = NoToneMapping; break;
        case 'Linear': this.renderer.toneMapping = LinearToneMapping; break;
        case 'Reinhard': this.renderer.toneMapping = ReinhardToneMapping; break;
        case 'Cineon': this.renderer.toneMapping = CineonToneMapping; break;
        case 'ACES': default: this.renderer.toneMapping = ACESFilmicToneMapping; break;
      }
    });

    generalFolder.addBinding(this.renderParams, 'exposure', {
      label: 'Exposure',
      min: 0.2,
      max: 2.5,
      step: 0.01
    }).on('change', (ev) => {
      this.renderer.toneMappingExposure = ev.value;
    });

    generalFolder.addBinding(this.renderParams, 'pixelRatio', {
      label: 'Pixel Ratio',
      min: 0.25,
      max: Math.max(3.0, window.devicePixelRatio), // Allow native DPR or up to 3.0
      step: 0.25
    }).on('change', (ev) => {
      this.renderer.setPixelRatio(ev.value);
      
      // Update cluster lighting system for new render size
      if (this.sharedClusterLightingSystem && this.currentScene) {
        // Resize the renderer
        this.onResize();
      }
    });

    // Separator between render and performance settings
    generalFolder.addBlade({ view: 'separator' });

    // Cluster performance settings
    generalFolder.addBinding(this.perfParams, 'enabled', {
      label: 'Auto-Tune FPS'
    }).on('change', (ev) => {
      this.adaptiveTileSpan.setEnabled(ev.value);
    });

    generalFolder.addBinding(this.perfParams, 'targetFPS', {
      label: 'Target FPS',
      min: 30,
      max: 144,
      step: 1
    }).on('change', (ev) => {
      this.adaptiveTileSpan.setTargetFPS(ev.value);
    });

    generalFolder.addBinding(this.perfParams, 'minTileSpan', {
      label: 'Min # Tiles',
      min: 6,  // Below 8 causes tile boundary artifacts
      max: 16,
      step: 1
    }).on('change', (ev) => {
      this.adaptiveTileSpan.minTileSpan = ev.value;
    });

    generalFolder.addBinding(this.perfParams, 'maxTileSpan', {
      label: 'Max # Tiles',
      min: 8,
      max: 24,
      step: 1
    }).on('change', (ev) => {
      this.adaptiveTileSpan.maxTileSpan = ev.value;
    });

    // Read-only stats
    generalFolder.addBlade({ view: 'separator' });
    
    generalFolder.addBinding(this.perfParams, 'currentTileSpan', {
      label: 'Current # Tiles',
      readonly: true
    });

    // Separator between global controls and scene-specific UI
    this.pane.addBlade({ view: 'separator' });

    // Don't add scene-specific UI here - it will be added by switchScene()
  }

  switchScene(sceneKey) {
    if (!this.scenes[sceneKey]) {
      console.warn(`[SceneManager] Scene ${sceneKey} not found`);
      return;
    }

    // If already switching to this scene, ignore
    if (this._targetScene === sceneKey) {
      return;
    }

    // Cancel any pending transition
    if (this._transitionTimeout1) {
      clearTimeout(this._transitionTimeout1);
      this._transitionTimeout1 = null;
    }
    if (this._transitionTimeout2) {
      clearTimeout(this._transitionTimeout2);
      this._transitionTimeout2 = null;
    }

    this._targetScene = sceneKey;

    // Get transition overlay element
    const transitionOverlay = document.getElementById('scene-transition');
    if (!transitionOverlay) {
      console.warn('[SceneManager] No transition overlay found, switching instantly');
      this._performSceneSwitch(sceneKey);
      this._targetScene = null;
      return;
    }

    // Start fade-out transition
    transitionOverlay.classList.add('fade-in');

    // Wait for fade-out to complete (300ms as defined in CSS)
    this._transitionTimeout1 = setTimeout(() => {
      // Perform the actual scene switch while screen is black
      this._performSceneSwitch(sceneKey);

      // Start fade-in transition after a short delay
      this._transitionTimeout2 = setTimeout(() => {
        transitionOverlay.classList.remove('fade-in');
        this._targetScene = null;
        this._transitionTimeout1 = null;
        this._transitionTimeout2 = null;
      }, 50);
    }, 300);
  }

  _performSceneSwitch(sceneKey) {
    // Deactivate current scene
    if (this.currentScene) {
      this.currentScene.deactivate();

      // DON'T call scene.dispose() - scenes share the lighting system
      // Calling dispose would null out the shared WASM module
      // Just deactivate is sufficient for cleanup

      // Remove scene-specific UI
      // Structure: 0=selector, 1=general, 2=separator, 3+...=scene UI
      // Keep only the first 3 children (selector, general folder, separator)
      const KEEP_COUNT = 3; // selector, general, separator
      
      while (this.pane.children.length > KEEP_COUNT) {
        const lastChild = this.pane.children[this.pane.children.length - 1];
        lastChild.dispose();
      }
    }

    // Reset adaptive tile span FPS history when switching scenes
    if (this.adaptiveTileSpan) {
      this.adaptiveTileSpan.reset();
    }

    // Clear lights before switching (shared lighting system)
    if (this.sharedClusterLightingSystem) {
      this.sharedClusterLightingSystem.clearLights();
    }

    // Set to null temporarily to prevent rendering during switch
    this.currentScene = null;

    // Defer scene activation by 1 frame to prevent main thread freeze on 32k lights
    // This allows the browser to update and remain responsive
    setTimeout(() => {
      this.currentScene = this.scenes[sceneKey];
      if (this.currentScene) {
        // Apply environment if available before lights/materials
        if (this.environmentMap && this.currentScene.scene) {
          this.currentScene.scene.environment = this.environmentMap;
        }
        // Initialize lights BEFORE activating to prevent rendering with uninitialized textures
        this.currentScene.initLights();

        // Now activate the scene (starts rendering)
        this.currentScene.activate();

        // Update scene selector dropdown to match current scene
        this.sceneParams.scene = sceneKey;
        this.sceneSelector.value = sceneKey;

        // Create UI
        this.currentScene.createUI(this.pane);

        // Add scene info button at the bottom if available
        this.pane.addBlade({ view: 'separator' });
        if (this.currentScene.getSceneInfo) {
          const info = this.currentScene.getSceneInfo();
          if (info) {
            this.pane.addButton({ title: 'ℹ️ About This Scene' }).on('click', () => {
              this.showSceneInfo(info);
            });
          }
        }
        this.pane.addBlade({ view: 'separator' });

        // Update URL hash
        this.updateURL(sceneKey);

        // Log light count
        const exported = this.sharedClusterLightingSystem.exportLights();
      }
    }, 16); // ~1 frame delay to let browser breathe
  }

  loadEnvironmentMap() {
    try {
      const pmremGenerator = new PMREMGenerator(this.renderer);
      pmremGenerator.compileEquirectangularShader();

      // Load HDR from public/assets
      new RGBELoader()
        .setPath('/assets/')
        .load('moonless_golf_1k.hdr', (hdrTexture) => {
          const envMap = pmremGenerator.fromEquirectangular(hdrTexture).texture;
          hdrTexture.dispose();
          pmremGenerator.dispose();

          this.environmentMap = envMap;

          // Apply to all existing scenes
          if (this.scenes) {
            Object.values(this.scenes).forEach(scene => {
              if (scene && scene.scene) {
                scene.scene.environment = envMap;
              }
            });
          }
        }, undefined, (err) => {
          console.error('[SceneManager] Failed to load HDR environment:', err);
        });
    } catch (e) {
      console.error('[SceneManager] Error initializing environment map:', e);
    }
  }

  setupURLRouting() {
    // Listen for hash changes (back/forward navigation)
    this.hashChangeHandler = () => {
      const scene = this.getSceneFromURL();
      if (scene && this.scenes[scene]) {
        // Check if we're not already on this scene
        if (this.sceneParams?.scene !== scene) {
          this.switchScene(scene);
          // Update the UI dropdown to match
          if (this.pane && this.pane.children[0]) {
            this.pane.children[0].value = scene;
          }
        }
      }
    };
    window.addEventListener('hashchange', this.hashChangeHandler);
  }

  getSceneFromURL() {
    const hash = window.location.hash.slice(1); // Remove '#'
    return hash || null;
  }

  updateURL(sceneKey) {
    // Update URL hash without triggering hashchange event
    if (window.location.hash.slice(1) !== sceneKey) {
      history.replaceState(null, '', `#${sceneKey}`);
    }
  }

  onResize() {
    // Update all scenes, not just the current one
    // This ensures cameras maintain correct aspect ratio even when switching scenes after resize
    Object.values(this.scenes).forEach(scene => {
      if (scene && scene.onResize) {
        scene.onResize();
      }
    });

    if (this.sharedClusterLightingSystem) {
      this.sharedClusterLightingSystem.resize();
    }
  }

  // Called from main.js animation loop
  update() {
    if (!this.currentScene || !this.wasmReady || !this.clock) {
      return;
    }

    // Update adaptive tile span (framerate-based performance tuning)
    if (this.adaptiveTileSpan) {
      this.adaptiveTileSpan.update(0.016); // ~60Hz update rate
      
      // Update UI stats
      if (this.perfParams) {
        const stats = this.adaptiveTileSpan.getStats();
        this.perfParams.currentTileSpan = stats.currentTileSpan;
        this.perfParams.averageFPS = stats.averageFPS;
      }
    }

    // Render scene (shadeQuery timing happens inside BaseScene.render)
    this.currentScene.render();

    // Update GPU Total (assign + shade)
    this.updateGPUTotal();

    // Update light count display
    this.updateLightCount();
  }

  updateGPUTotal() {
    if (!this.gpuTotalTracker || !this.gpuTotalTracker.el) return;

    // Get current values from assign and shade queries
    const assignEl = document.querySelector("#perf-assign-value");
    const shadeEl = document.querySelector("#perf-shade-value");

    if (assignEl && shadeEl) {
      const assignValue = parseFloat(assignEl.innerText) || 0;
      const shadeValue = parseFloat(shadeEl.innerText) || 0;
      const total = assignValue + shadeValue;

      if (total > 0) {
        this.gpuTotalTracker.el.innerText = total.toFixed(2);
      }
    }
  }

  updateLightCount() {
    const lightsEl = document.querySelector("#perf-lights-value");
    if (!lightsEl || !this.sharedClusterLightingSystem) return;

    const totalLights = 
      (this.sharedClusterLightingSystem.pointLightCount || 0) +
      (this.sharedClusterLightingSystem.spotLightCount || 0) +
      (this.sharedClusterLightingSystem.rectLightCount || 0);

    lightsEl.textContent = totalLights.toString();
  }

  setupSceneInfoModal() {
    const modal = document.getElementById('scene-info-modal');
    const closeBtn = document.getElementById('scene-info-close');

    if (!modal || !closeBtn) {
      console.warn('[SceneManager] Scene info modal elements not found in DOM');
      return;
    }

    // Close on X button click
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('active');
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        modal.classList.remove('active');
      }
    });
  }

  showSceneInfo(info) {
    const modal = document.getElementById('scene-info-modal');
    const title = document.getElementById('scene-info-title');
    const text = document.getElementById('scene-info-text');

    if (!modal || !title || !text) {
      console.warn('[SceneManager] Scene info modal elements not found, falling back to alert');
      alert(typeof info === 'object' ? info.title : info);
      return;
    }

    // Support both HTML object format and legacy string format
    if (typeof info === 'object') {
      title.textContent = info.title;
      text.innerHTML = info.content;
    } else {
      // Legacy format: "Title\n\nBody"
      const lines = info.split('\n');
      const titleText = lines[0] || 'Scene Information';
      const bodyText = lines.slice(2).join('\n');
      title.textContent = titleText;
      text.textContent = bodyText;
    }

    // Show modal
    modal.classList.add('active');
  }

  dispose() {
    // Cancel any pending transitions
    if (this._transitionTimeout1) {
      clearTimeout(this._transitionTimeout1);
      this._transitionTimeout1 = null;
    }
    if (this._transitionTimeout2) {
      clearTimeout(this._transitionTimeout2);
      this._transitionTimeout2 = null;
    }

    // Remove event listeners
    if (this.hashChangeHandler) {
      window.removeEventListener('hashchange', this.hashChangeHandler);
      this.hashChangeHandler = null;
    }

    Object.values(this.scenes).forEach(scene => scene.dispose());

    if (this.sharedClusterLightingSystem) {
      this.sharedClusterLightingSystem.dispose();
    }

    if (this.pane) {
      this.pane.dispose();
    }

    if (this.shadeQuery) {
      this.shadeQuery = null;
    }
  }
}
