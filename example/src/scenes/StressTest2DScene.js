// StressTest2DScene.js - 2D performance stress test with thousands of lights
import { Vector3, PlaneGeometry, MeshStandardMaterial, Mesh, SphereGeometry, BoxGeometry, Color } from 'three';
import { BaseScene } from './BaseScene.js';

export class StressTest2DScene extends BaseScene {
  constructor(renderer, lightsSystem) {
    super(renderer, lightsSystem, {
      cameraPosition: new Vector3(102.51, 48.56, 101.54),
      controlsTarget: new Vector3(3.95, -18.10, 8.11),
      maxDistance: 50000,
      minDistance: 1,
      near: 0.1,
      far: 100000,  // Huge far plane to prevent clipping at any zoom level
      showLightMarkers: true,
      showGlow: false,
      pointGlowRadius: 0.3
    });


    this.params = {
      lightCount: 2000,  // Start with 2000, adjust up to test your GPU
      animationSpeed: 1.0,
      waveAmplitude: 5,
      lightRadius: 8,
      lightIntensity: 15,
      lodBias: 50.0,
      animationPreset: 'wave',  // wave, pulse, ripple, spiral, random, none
      lightType: 'point' // point | spot
    };

    this.lightCountDisplay = { count: 0 };
    this.stressTestLightsConfigured = false;  // Track one-time light configuration
  }

  getSceneInfo() {
    return {
      title: '2D Stress Test',
      content: `
        <p>This demo uses WASM animation for maximum performance. All light calculations happen in WebAssembly with little JavaScript overhead.</p>
        
        <p>Increase the Light Count slider to see how many lights your GPU can handle</p>
        
        <h3>Performance Tips</h3>
        <ul>
          <li>Grid scene: ~2000 lights</li>
          <li>This scene: Test up to 32,000 lights if your GPU has support</li>
          <li>Rendering is GPU-limited, not CPU-limited</li>
          <li>WASM handles all animation internally</li>
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
    // Ground plane - will be resized in initLights based on light count
    const groundGeometry = new PlaneGeometry(100, 100);
    const groundMaterial = new MeshStandardMaterial({
      color: 0x202020,
      roughness: 0.8,
      metalness: 0.2
    });
    this.ground = new Mesh(groundGeometry, groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);

    // Add objects in sparse grid - will be repositioned in initLights
    this.spheres = [];
    this.addSceneObjects();
  }

  addSceneObjects() {
    // Create 25 spheres (5x5 grid) - positions will be set in updateSceneObjects
    for (let i = 0; i < 25; i++) {
      const geometry = new SphereGeometry(1.5, 32, 32);
      const material = new MeshStandardMaterial({
        color: new Color().setHSL(i / 25, 0.7, 0.5),
        roughness: 0.1,
        metalness: 0.9
      });
      const mesh = new Mesh(geometry, material);
      this.scene.add(mesh);
      this.spheres.push(mesh);
    }
  }

  updateSceneObjects() {
    // Position spheres in 5x5 sparse grid based on light grid size
    const gridSize = Math.floor(Math.sqrt(this.params.lightCount));
    const spacing = 4;
    const totalSize = gridSize * spacing;
    const sphereSpacing = totalSize / 5;
    const offset = totalSize / 2;

    let idx = 0;
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        if (idx < this.spheres.length) {
          this.spheres[idx].position.set(
            x * sphereSpacing - offset + sphereSpacing / 2,
            2,
            z * sphereSpacing - offset + sphereSpacing / 2
          );
          idx++;
        }
      }
    }
  }

  initLights() {
    // Clear and reconfigure with desired count (reuses pre-allocated WASM memory)
    this.lightsSystem.clearLights();

    // Set scene-specific LOD bias
    this.lightsSystem.setLODBias(this.params.lodBias);

    const desiredCount = this.params.lightCount;
    const startTime = performance.now();

    const gridSize = Math.floor(Math.sqrt(desiredCount));
    const spacing = 4;
    const offset = (gridSize * spacing) / 2;

    // Generate lights with animation based on preset
    const lights = [];
    let idx = 0;
    for (let x = 0; x < gridSize && idx < desiredCount; x++) {
      for (let z = 0; z < gridSize && idx < desiredCount; z++) {
        const worldX = x * spacing - offset;
        const worldZ = z * spacing - offset;
        const distFromCenter = Math.sqrt(worldX * worldX + worldZ * worldZ);
        const angleFromCenter = Math.atan2(worldZ, worldX);

        // Base light config (point or spot)
        const baseColor = new Color().setHSL((x + z) / (gridSize * 2), 0.8, 0.5);
        const isSpot = this.params.lightType === 'spot';
        const light = isSpot ? {
          type: 'spot',
          position: new Vector3(worldX, 5, worldZ),
          color: baseColor,
          intensity: this.params.lightIntensity * 1.25,
          radius: this.params.lightRadius * 2,
          decay: 2,
          direction: new Vector3(0, 1, 0),
          angle: Math.PI / 6,
          penumbra: 0.15
        } : {
          type: 'point',
          position: new Vector3(worldX, 3, worldZ),
          color: baseColor,
          intensity: this.params.lightIntensity,
          radius: this.params.lightRadius,
          decay: 2
        };

        // Add animation based on preset
        switch (this.params.animationPreset) {
          case 'wave':
            light.animation = {
              wave: {
                axis: [0, 1, 0],
                speed: this.params.animationSpeed,
                amplitude: this.params.waveAmplitude * 0.2,
                phase: (x + z) * 0.1
              }
            };
            break;

          case 'pulse':
            light.animation = {
              pulse: {
                speed: this.params.animationSpeed * (1 + Math.random() * 0.5),
                amount: 0.5,
                target: 1  // PulseTarget.INTENSITY
              }
            };
            break;

          case 'ripple':
            // Radial wave from center
            light.animation = {
              wave: {
                axis: [0, 1, 0],
                speed: this.params.animationSpeed,
                amplitude: this.params.waveAmplitude * 0.2,
                phase: distFromCenter * 0.1
              },
              pulse: {
                speed: this.params.animationSpeed * 2,
                amount: 0.3,
                target: 1  // PulseTarget.INTENSITY
              }
            };
            break;

          case 'spiral':
            // Spiral pattern based on angle and distance
            light.animation = {
              wave: {
                axis: [0, 1, 0],
                speed: this.params.animationSpeed,
                amplitude: this.params.waveAmplitude * 0.2,
                phase: angleFromCenter + distFromCenter * 0.05
              }
            };
            break;

          case 'random':
            // Random animations for chaos
            const animType = Math.floor(Math.random() * 3);
            if (animType === 0) {
              light.animation = {
                wave: {
                  axis: [Math.random(), Math.random(), Math.random()],
                  speed: this.params.animationSpeed * (0.5 + Math.random()),
                  amplitude: this.params.waveAmplitude * 0.2,
                  phase: Math.random() * Math.PI * 2
                }
              };
            } else if (animType === 1) {
              light.animation = {
                pulse: {
                  speed: this.params.animationSpeed * (0.5 + Math.random() * 2),
                  amount: 0.3 + Math.random() * 0.4,
                  target: Math.random() > 0.5 ? 1 : 2  // PulseTarget.INTENSITY or PulseTarget.RADIUS
                }
              };
            } else {
              light.animation = {
                circular: {
                  speed: this.params.animationSpeed * (0.5 + Math.random()),
                  radius: 0.5 + Math.random() * 1.5
                }
              };
            }
            break;

          case 'none':
            // No animation
            break;

          default:
            // Wave as default
            light.animation = {
              wave: {
                axis: [0, 1, 0],
                speed: this.params.animationSpeed,
                amplitude: this.params.waveAmplitude * 0.2,
                phase: (x + z) * 0.1
              }
            };
        }

        lights.push(light);
        idx++;
      }
    }

    // Use bulk config for maximum performance (single WASM call vs thousands)
    if (this.params.lightType === 'point') {
      this.lightsSystem.bulkConfigPointLights(lights, false);
    } else {
      this.lightsSystem.bulkConfigLights(lights, false);
    }

    // Update ground plane and spheres based on active light count
    const activeGridSize = Math.floor(Math.sqrt(desiredCount));
    const activeSpacing = 4;
    const totalSize = activeGridSize * activeSpacing;

    this.ground.geometry.dispose();
    this.ground.geometry = new PlaneGeometry(totalSize * 1.5, totalSize * 1.5);
    this.updateSceneObjects();

    // Update stats display
    this.lightCountDisplay.count = desiredCount;

    // Update light source visualization
    if (this.showLightMarkers) {
      this.lightMarkers.reinit(this.scene);
    }
  }

  createUI(pane) {
    super.createUI(pane);

    const demoFolder = pane.addFolder({ title: '2D Stress Test', expanded: true });

    // Animation preset selector
    demoFolder.addBlade({
      view: 'list',
      label: 'Animation',
      options: [
        { text: 'Wave', value: 'wave' },
        { text: 'Pulse', value: 'pulse' },
        { text: 'Ripple', value: 'ripple' },
        { text: 'Spiral', value: 'spiral' },
        { text: 'Random', value: 'random' },
        { text: 'None', value: 'none' }
      ],
      value: this.params.animationPreset
    }).on('change', (ev) => {
      this.params.animationPreset = ev.value;
      this.initLights();
    });

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

    // Light count control - stress test how many your GPU can handle
    demoFolder.addBinding(this.params, 'lightCount', {
      min: 100,
      max: this.lightsSystem.maxSafeLights || 2048,
      step: 100,
      label: 'Light Count'
    }).on('change', (ev) => {
      // Just update active light count (instant - reuses pre-allocated memory)
      this.initLights();
      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }
    });

    demoFolder.addBinding(this.params, 'lightRadius', {
      min: 1, max: 10, step: 0.5, label: 'Light Radius'
    }).on('change', (ev) => {
      // Regenerate lights with new radius
      this.initLights();
      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }
    });

    demoFolder.addBinding(this.params, 'lightIntensity', {
      min: 1, max: 50, step: 1, label: 'Light Intensity'
    }).on('change', (ev) => {
      // Regenerate lights with new intensity
      this.initLights();
      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }
    });

    demoFolder.addBinding(this.params, 'animationSpeed', {
      min: 0, max: 5, step: 0.1, label: 'Animation Speed'
    }).on('change', (ev) => {
      // Regenerate lights with new animation speed
      this.initLights();
    });

    demoFolder.addBinding(this.params, 'waveAmplitude', {
      min: 0, max: 10, step: 0.5, label: 'Wave Amplitude'
    }).on('change', (ev) => {
      // Regenerate lights with new wave amplitude
      this.initLights();
    });

    // LOD Bias
    demoFolder.addBinding(this.params, 'lodBias', {
      min: 0.1, max: 100.0, step: 0.1, label: 'LOD Bias'
    }).on('change', (ev) => {
      this.lightsSystem.setLODBias(ev.value);
    });
  }

  // No update() needed - WASM handles all animation internally

  dispose() {
    super.dispose();
  }
}
