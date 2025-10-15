// StressTest3DScene.js - 3D stress test scene with bouncing lights
import { Vector3, Color, Box3, AmbientLight, DirectionalLight } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { BaseScene } from './BaseScene.js';

const DRACO_DECODER_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';
const SPONZA_MODEL_URL = '/assets/models/Sponza.glb';

export class StressTest3DScene extends BaseScene {
  constructor(renderer, lightsSystem) {
    super(renderer, lightsSystem, {
      cameraPosition: new Vector3(0, -200, 690),
      controlsTarget: new Vector3(0, -280, 0),
      maxDistance: 4000,
      minDistance: 50,
      near: 10,
      far: 10000,
      showLightMarkers: true,
      showGlow: true,
      pointGlowRadius: 0.2
    });

    this.params = {
      lightCount: 3500,
      bounceSpeed: 1.0,
      lightRadius: 100,
      lightIntensity: 10,
      lodBias: 1500.0,
      lightType: 'point'
    };

    this.lightCountDisplay = { count: 0 };
    
    // Light visualization params
    this.lightParams = {
      glowRadius: 0.2
    };

    // Marker visualization params
    this.markerParams = {
      markerScale: 0.039
    };

    // Sponza model
    this.sponza = null;
    this.sponzaLoading = false;
    // Set default bounds for Sponza (approximate, will be updated when model loads)
    this.sponzaBounds = new Box3(
      new Vector3(-1000, 0, -400),
      new Vector3(1000, 300, 400)
    );
    
    // GLTFLoader setup
    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_URL);
    this.loader.setDRACOLoader(dracoLoader);

    // Bouncing light data (positions and velocities)
    this.lightData = [];
  }

  getSceneInfo() {
    return {
      title: '3D Stress Test',
      content: `
        <p>This demo loads the classic Sponza model and fills it with thousands of bouncing point lights.</p>
        
        <p>Lights bounce around the scene boundaries in real-time, creating dynamic, ever-changing lighting conditions.</p>
        
        <p>All light calculations happen in WebAssembly with zero JavaScript overhead.</p>
        
        <h3>Performance Tips</h3>
        <ul>
          <li>Bouncing lights stress the clustering system as they move</li>
          <li>Light positions are updated via bulk WASM updates each frame</li>
          <li>Adjust bounce speed to see more or less chaotic movement</li>
          <li>Use glow and marker controls to fine-tune visualization</li>
        </ul>
      `
    };
  }

  getStatsBindings() {
    return [
      { object: this.lightCountDisplay, property: 'count', label: '💡 Active Lights', format: (v) => `${v} lights` }
    ];
  }

  init() {
    // Setup scene
    this.scene.fog = null;
    this.scene.background = new Color(0x000000);
    
    // Apply initial glow radius to options
    this.options.pointGlowRadius = this.lightParams.glowRadius;
    
    // Add directional light for basic visibility
    const light = new DirectionalLight(0xffffff, 3);
    light.position.set(1500, 1000, 0);
    this.scene.add(light);
    
    // Don't load Sponza or initialize lights here - wait for scene activation
  }

  loadSponza() {    
    this.loader.load(
      SPONZA_MODEL_URL,
      (gltf) => {
        this.sponza = gltf.scene;
        this.sponza.traverse((child) => {
          if (child.isMesh) {
            // Note: Shadows are disabled in main.js, so these won't take effect
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        
        // Calculate original bounds
        const originalBounds = new Box3().setFromObject(this.sponza);
        const originalSize = new Vector3();
        originalBounds.getSize(originalSize);
                
        // Scale Sponza to fit the desired bounds (make it larger for dramatic effect)
        // Target: roughly 2000 units wide, maintaining aspect ratio
        const targetWidth = 2000;
        const scaleFactor = targetWidth / originalSize.x;
        this.sponza.scale.setScalar(scaleFactor);
        
        // Center the model at origin
        const center = new Vector3();
        originalBounds.getCenter(center);
        this.sponza.position.set(
          -center.x * scaleFactor,
          -center.y * scaleFactor,
          -center.z * scaleFactor
        );
        
        this.scene.add(this.sponza);
        
        // Mark scene as dirty to trigger material patching in next render
        this._sceneDirty = true;
        
        // Recalculate bounds after scaling
        this.sponzaBounds.setFromObject(this.sponza);
        const finalSize = new Vector3();
        this.sponzaBounds.getSize(finalSize);
        this.initLights();
      },
      (progress) => {
        const percent = (progress.loaded / progress.total * 100).toFixed(1);
      },
      (error) => {
        console.error('[StressTest3D] Error loading Sponza:', error);
      }
    );
  }

  initLights() {
    // Load Sponza on first activation if not already loading/loaded
    if (!this.sponza && !this.sponzaLoading) {
      this.sponzaLoading = true;
      this.loadSponza();
      // Lights will be initialized after Sponza loads
      return;
    }

    this.lightsSystem.clearLights();
    this.lightsSystem.setLODBias(this.params.lodBias);

    const desiredCount = this.params.lightCount;
    const startTime = performance.now();

    // Get bounds with some padding
    const min = this.sponzaBounds.min.clone();
    const max = this.sponzaBounds.max.clone();
    const padding = 100; // Keep lights comfortably inside with margin
    min.addScalar(padding);
    max.addScalar(-padding);

    const lights = [];
    this.lightData = []; // Reset light data

    for (let i = 0; i < desiredCount; i++) {
      // Random position within bounds
      const position = new Vector3(
        min.x + Math.random() * (max.x - min.x),
        min.y + Math.random() * (max.y - min.y),
        min.z + Math.random() * (max.z - min.z)
      );

      // Random velocity
      const velocity = new Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      );

      // White color for all lights
      const color = new Color(0xffffff);

      const isSpot = this.params.lightType === 'spot';
      
      const light = isSpot ? {
        type: 'spot',
        position: position.clone(),
        color: color,
        intensity: this.params.lightIntensity * 1.25,
        radius: this.params.lightRadius * 2,
        decay: 2,
        direction: new Vector3(0, -1, 0),
        angle: Math.PI / 6,
        penumbra: 0.15
      } : {
        type: 'point',
        position: position.clone(),
        color: color,
        intensity: this.params.lightIntensity,
        radius: this.params.lightRadius,
        decay: 2
      };

      lights.push(light);
      
      // Store position and velocity for bouncing
      this.lightData.push({
        index: i,
        position: position,
        velocity: velocity,
        color: color
      });
    }

    // Bulk config for performance
    if (this.params.lightType === 'point') {
      this.lightsSystem.bulkConfigPointLights(lights, false);
    } else {
      this.lightsSystem.bulkConfigLights(lights, false);
    }

    const endTime = performance.now();
    
    this.lightCountDisplay.count = desiredCount;

    if (this.showLightMarkers && this.lightMarkers) {
      this.lightMarkers.reinit(this.scene);
      
      // Apply glow and marker settings after reinit
      this.lightMarkers.setGlowRadius(this.lightParams.glowRadius);
      this.lightMarkers.setMarkerScale(this.markerParams.markerScale);
    }
  }

  createUI(pane) {
    super.createUI(pane);

    const demoFolder = pane.addFolder({ title: 'Light Settings', expanded: true });

    // Light type selector
    demoFolder.addBlade({
      view: 'list',
      label: 'Light Type',
      options: [
        { text: 'Point', value: 'point' },
        { text: 'Spot', value: 'spot' }
      ],
      value: this.params.lightType
    }).on('change', (ev) => {
      this.params.lightType = ev.value;
      this.initLights();
      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }
    });

    // Light count control
    demoFolder.addBinding(this.params, 'lightCount', {
      min: 100,
      max: this.lightsSystem.maxSafeLights || 2048,
      step: 50,
      label: 'Light Count'
    }).on('change', (ev) => {
      this.initLights();
      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }
    });

    demoFolder.addBinding(this.params, 'lightRadius', {
      min: 5, max: 150, step: 5, label: 'Light Radius'
    }).on('change', (ev) => {
      this.initLights();
      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }
    });

    demoFolder.addBinding(this.params, 'lightIntensity', {
      min: 10, max: 200, step: 10, label: 'Light Intensity'
    }).on('change', (ev) => {
      this.initLights();
      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }
    });

    demoFolder.addBinding(this.params, 'bounceSpeed', {
      min: 0, max: 5, step: 0.1, label: 'Bounce Speed'
    });

    // LOD Bias
    demoFolder.addBinding(this.params, 'lodBias', {
      min: 0.1, max: 100.0, step: 0.1, label: 'LOD Bias'
    }).on('change', (ev) => {
      this.lightsSystem.setLODBias(ev.value);
    });

    // Separator
    demoFolder.addBlade({ view: 'separator' });

    // Glow Radius
    demoFolder.addBinding(this.lightParams, 'glowRadius', {
      min: 0.1,
      max: 2,
      step: 0.05,
      label: 'Glow Size'
    }).on('change', (ev) => {
      this._applyGlowRadius(ev.value);
    });

    // Marker Scale
    demoFolder.addBinding(this.markerParams, 'markerScale', {
      min: 0.001,
      max: 0.1,
      step: 0.001,
      label: 'Marker Scale'
    }).on('change', (ev) => {
      if (this.lightMarkers) {
        this.lightMarkers.setMarkerScale(ev.value);
      }
    });

  }

  update(time, deltaTime = 0.016) {
    // Update bouncing lights
    if (this.lightData.length === 0 || this.sponzaBounds.isEmpty()) {
      return;
    }

    // Get bounds with padding
    const min = this.sponzaBounds.min.clone();
    const max = this.sponzaBounds.max.clone();
    const padding = 100;
    min.addScalar(padding);
    max.addScalar(-padding);

    const speedMultiplier = this.params.bounceSpeed;
    const damping = 0.99; // Slight energy loss on bounce

    // Update each light
    for (let i = 0; i < this.lightData.length; i++) {
      const data = this.lightData[i];
      
      // Apply velocity
      data.position.x += data.velocity.x * speedMultiplier;
      data.position.y += data.velocity.y * speedMultiplier;
      data.position.z += data.velocity.z * speedMultiplier;

      // Bounce off bounds
      if (data.position.x < min.x || data.position.x > max.x) {
        data.velocity.x *= -damping;
        data.position.x = Math.max(min.x, Math.min(max.x, data.position.x));
      }
      if (data.position.y < min.y || data.position.y > max.y) {
        data.velocity.y *= -damping;
        data.position.y = Math.max(min.y, Math.min(max.y, data.position.y));
      }
      if (data.position.z < min.z || data.position.z > max.z) {
        data.velocity.z *= -damping;
        data.position.z = Math.max(min.z, Math.min(max.z, data.position.z));
      }

      // Update light position in WASM
      this.lightsSystem.updateLightPosition(data.index, data.position);
    }
  }

  _applyGlowRadius(glowRadius) {
    this.lightParams.glowRadius = glowRadius;
    this.options.pointGlowRadius = glowRadius;

    if (this.lightMarkers) {
      this.lightMarkers.setGlowRadius(glowRadius);
    }
  }

  dispose() {
    // Clear fog
    this.scene.fog = null;
    
    // Clean up Sponza model
    if (this.sponza) {
      this.scene.remove(this.sponza);
      this.sponza.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => {
              if (m.map) m.map.dispose();
              if (m.normalMap) m.normalMap.dispose();
              if (m.roughnessMap) m.roughnessMap.dispose();
              if (m.metalnessMap) m.metalnessMap.dispose();
              m.dispose();
            });
          } else {
            if (child.material.map) child.material.map.dispose();
            if (child.material.normalMap) child.material.normalMap.dispose();
            if (child.material.roughnessMap) child.material.roughnessMap.dispose();
            if (child.material.metalnessMap) child.material.metalnessMap.dispose();
            child.material.dispose();
          }
        }
      });
      this.sponza = null;
    }
    
    // Clear light data
    this.lightData = [];
    
    super.dispose();
  }
}

