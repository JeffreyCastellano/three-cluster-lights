// LightPlaygroundScene.js - Light playground with Tweakpane UI
import { Vector3, Color, BoxGeometry, MeshStandardMaterial, Mesh, TorusGeometry, SphereGeometry, PlaneGeometry } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { BaseScene } from './BaseScene.js';
import { PulseTarget, LinearMode } from '../../lib/index.js';

export class LightPlaygroundScene extends BaseScene {
  constructor(renderer, lightsSystem) {
    super(renderer, lightsSystem, {
      cameraPosition: new Vector3(40, 30, 40),
      controlsTarget: new Vector3(0, 20, 0),
      maxDistance: 200,
      minDistance: 5,
      performanceMode: true,
      showLightMarkers: true,
      showGlow: true,
      pointGlowRadius: 0.5,
      spotGlowRadius: 0.5,
      rectGlowRadius: 0.5
    });

    this.params = {
      preset: 'discoModel',
      performanceCount: 2000,
      lodBias: 1.0,
      dynamicClusters: true,
      showLightMarkers: true,
      showGlow: true,
      glowRadius: 0.5
    };

    this.sceneObjects = {};
    this.isPerformanceTest = false;
    this.lightsList = []; // Track all lights
    this.selectedLightIndex = null;
    this.lightsFolder = null;
    this.animControlsFolder = null;
    this.helmetModel = null;
    this.isLoadingHelmet = false;
    this.helmetFloatTime = 0; // Track time for floating animation
    this.lightCountDisplay = { total: 0, animated: 0, static: 0 }; // Direct stats tracking

    // Setup GLTF loader with Draco support
    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.loader.setDRACOLoader(dracoLoader);
  }

  getSceneInfo() {
    return {
      title: 'Light Playground',
      content: `
        <p>Interactive scene for adding and animating individual lights. Add lights with various animation types and customize each one individually.</p>
        
        <h3>Animation Types</h3>
        <ul>
          <li><strong>Circular</strong> - orbit around a point</li>
          <li><strong>Linear</strong> - move back and forth</li>
          <li><strong>Wave</strong> - oscillate along an axis</li>
          <li><strong>Flicker</strong> - random intensity variations</li>
          <li><strong>Pulse</strong> - smooth intensity/radius pulsing</li>
          <li><strong>Rotating Spot</strong> - spinning spotlight</li>
          <li><strong>Pulsing Rect</strong> - animated rectangle light</li>
        </ul>
        
        <h3>Features</h3>
        <ul>
          <li>Click a light to select and edit it (N/A on Disco Model)</li>
          <li>Combine multiple animations</li>
          <li>All animations run inside WASM for performance</li>
        </ul>
      `
    };
  }

  getStatsBindings() {
    return [
      { object: this.lightCountDisplay, property: 'total', label: 'Total Lights' },
      { object: this.lightCountDisplay, property: 'animated', label: 'Animated' },
      { object: this.lightCountDisplay, property: 'static', label: 'Static' }
    ];
  }

  addAnimatedLight(animationType) {
    const basePos = new Vector3(
      Math.random() * 20 - 10,
      Math.random() * 5 + 2,
      Math.random() * 20 - 10
    );

    let newLight = {
      position: basePos,
      color: new Color().setHSL(Math.random(), 0.7, 0.5),
      intensity: 20,
      radius: 10,
      decay: 2
    };

    switch(animationType) {
      case 'circular':
        newLight.type = 'point';
        newLight.animation = { circular: { speed: 1, radius: 2 } };
        break;

      case 'linear':
        newLight.type = 'point';
        newLight.animation = {
          linear: {
            to: new Vector3(basePos.x + 10, basePos.y, basePos.z),
            duration: 3,
            mode: 'pingpong'
          }
        };
        break;

      case 'wave':
        newLight.type = 'point';
        newLight.animation = {
          wave: { axis: [0, 1, 0], speed: 2, amplitude: 2 }
        };
        break;

      case 'flicker':
        newLight.type = 'point';
        newLight.animation = {
          flicker: { speed: 15, intensity: 0.4 }
        };
        break;

      case 'pulse':
        newLight.type = 'point';
        newLight.animation = {
          pulse: { speed: 1, amount: 0.1, target: PulseTarget.INTENSITY }
        };
        break;

      case 'rotating-spot':
        newLight.type = 'spot';
        newLight.direction = new Vector3(0, -1, 0);
        newLight.angle = Math.PI / 6;
        newLight.penumbra = 0.2;
        newLight.animation = {
          rotation: { axis: [0, 1, 0], speed: 0.5, mode: 'continuous' }
        };
        break;

      case 'pulsing-rect':
        newLight.type = 'rect';
        newLight.width = 5;
        newLight.height = 5;
        newLight.normal = new Vector3(0, -1, 0);
        newLight.position.y = 9;
        newLight.animation = {
          pulse: { speed: 0.5, amount: 0.1, target: PulseTarget.INTENSITY }
        };
        break;

      case 'combined':
        newLight.type = 'point';
        newLight.animation = {
          circular: { speed: 0.5, radius: 1.5 },
          pulse: { speed: 2, amount: 0.1, target: PulseTarget.INTENSITY }
        };
        break;
    }

    const index = this.lightsSystem.addLight(newLight);
    this.lightsList.push({ index, type: newLight.type, animationType, light: newLight });

    // Reinitialize light sources (light count changed)
    if (this.lightMarkers) {
      this.lightMarkers.reinit(this.scene);
    }

    // Update stats
    this.lightCountDisplay.total++;
    if (newLight.animation) {
      this.lightCountDisplay.animated++;
    } else {
      this.lightCountDisplay.static++;
    }

    // Update lights list UI
    this.updateLightsList();
  }

  updateLightsList() {
    if (!this.lightsFolder) {
      console.warn('[AnimationDemo] updateLightsList called but lightsFolder is null');
      return;
    }

    console.log('[AnimationDemo] updateLightsList called');

    // Remove existing lights folder and recreate
    if (this.lightsFolder && !this.lightsFolder.disposed) {
      this.lightsFolder.dispose();
    }

    const lights = this.lightsSystem.exportLights();
    console.log('[AnimationDemo] Lights count:', lights.length);

    this.lightsFolder = this.mainFolder.addFolder({ title: `Lights (${lights.length})`, expanded: true });

    // Skip rendering individual light buttons if there are too many (performance)
    if (lights.length > 200) {
      this.lightsFolder.addBlade({
        view: 'text',
        label: 'Note',
        parse: (v) => String(v),
        value: `Too many lights (${lights.length}) to list individually`
      }).disabled = true;
      return;
    }

    lights.forEach((light, i) => {
      const animKeys = light.animation ? Object.keys(light.animation).join(', ') : 'static';
      const lightBtn = this.lightsFolder.addButton({
        title: `${light.type.charAt(0).toUpperCase() + light.type.slice(1)} ${i + 1} [${animKeys}]`
      });

      lightBtn.on('click', () => {
        this.selectLight(i);
      });
    });
  }

  selectLight(index) {
    this.selectedLightIndex = index;
    this.updateAnimationControls();
  }

  updateAnimationControls() {
    // Remove existing animation controls folder
    if (this.animControlsFolder && !this.animControlsFolder.disposed) {
      this.animControlsFolder.dispose();
      this.animControlsFolder = null;
    }

    if (this.selectedLightIndex === null) return;

    const lights = this.lightsSystem.exportLights();
    const light = lights[this.selectedLightIndex];
    if (!light) return;

    const anim = light.animation || {};

    this.animControlsFolder = this.mainFolder.addFolder({
      title: `Animation Controls - ${light.type.charAt(0).toUpperCase() + light.type.slice(1)} ${this.selectedLightIndex + 1}`,
      expanded: true
    });

    // Animation toggles
    const toggles = {};

    if (light.type === 'point') {
      toggles.circular = !!anim.circular;
      toggles.linear = !!anim.linear;
      toggles.wave = !!anim.wave;
    }

    if (light.type === 'spot' || light.type === 'rect') {
      toggles.linear = !!anim.linear;
      toggles.rotation = !!anim.rotation;
    }

    toggles.flicker = !!anim.flicker;
    toggles.pulse = !!anim.pulse;

    // Add toggle bindings
    Object.keys(toggles).forEach(animType => {
      this.animControlsFolder.addBinding(toggles, animType, {
        label: animType.charAt(0).toUpperCase() + animType.slice(1)
      }).on('change', (ev) => {
        this.toggleAnimation(animType, ev.value);
      });
    });

    // Add parameter controls
    if (anim.circular) {
      const circParams = { speed: anim.circular.speed || 1, radius: anim.circular.radius || 2 };
      this.animControlsFolder.addBinding(circParams, 'speed', { min: 0.1, max: 5, step: 0.1, label: 'Circular Speed' })
        .on('change', (ev) => this.updateAnimationProperty('circular', 'speed', ev.value));
      this.animControlsFolder.addBinding(circParams, 'radius', { min: 0.5, max: 5, step: 0.1, label: 'Circular Radius' })
        .on('change', (ev) => this.updateAnimationProperty('circular', 'radius', ev.value));
    }

    if (anim.pulse) {
      const pulseParams = { speed: anim.pulse.speed || 1, amount: anim.pulse.amount || 0.1 };
      this.animControlsFolder.addBinding(pulseParams, 'speed', { min: 0.1, max: 5, step: 0.1, label: 'Pulse Speed' })
        .on('change', (ev) => this.updateAnimationProperty('pulse', 'speed', ev.value));
      this.animControlsFolder.addBinding(pulseParams, 'amount', { min: 0.01, max: 1, step: 0.01, label: 'Pulse Amount' })
        .on('change', (ev) => this.updateAnimationProperty('pulse', 'amount', ev.value));
    }

    if (anim.flicker) {
      const flickerParams = { speed: anim.flicker.speed || 15, intensity: anim.flicker.intensity || 0.4 };
      this.animControlsFolder.addBinding(flickerParams, 'speed', { min: 1, max: 30, step: 1, label: 'Flicker Speed' })
        .on('change', (ev) => this.updateAnimationProperty('flicker', 'speed', ev.value));
      this.animControlsFolder.addBinding(flickerParams, 'intensity', { min: 0.1, max: 1, step: 0.05, label: 'Flicker Intensity' })
        .on('change', (ev) => this.updateAnimationProperty('flicker', 'intensity', ev.value));
    }
  }

  toggleAnimation(animType, enabled) {
    if (this.selectedLightIndex === null) return;

    const lights = this.lightsSystem.exportLights();
    const light = lights[this.selectedLightIndex];
    if (!light) return;

    const currentAnim = light.animation || {};
    let newAnim = { ...currentAnim };

    if (enabled) {
      switch(animType) {
        case 'circular':
          newAnim.circular = { speed: 1, radius: 2 };
          break;
        case 'linear':
          newAnim.linear = {
            to: new Vector3(light.position.x + 10, light.position.y, light.position.z),
            duration: 3,
            mode: 'pingpong'
          };
          break;
        case 'wave':
          newAnim.wave = { axis: [0, 1, 0], speed: 2, amplitude: 2 };
          break;
        case 'flicker':
          newAnim.flicker = { speed: 15, intensity: 0.4 };
          break;
        case 'pulse':
          newAnim.pulse = { speed: 1, amount: 0.1, target: PulseTarget.INTENSITY };
          break;
        case 'rotation':
          newAnim.rotation = { axis: [0, 1, 0], speed: 0.5, mode: 'continuous' };
          break;
      }
    } else {
      delete newAnim[animType];
    }

    this.lightsSystem.updateLightAnimation(
      this.selectedLightIndex,
      Object.keys(newAnim).length > 0 ? newAnim : null
    );

    this.updateLightsList();
    this.updateAnimationControls();
  }

  updateAnimationProperty(animType, property, value) {
    if (this.selectedLightIndex === null) return;
    this.lightsSystem.updateLightAnimationProperty(this.selectedLightIndex, animType, property, value);
  }

  loadHelmetModel(callback) {
    if (this.isLoadingHelmet) {
      console.log('[AnimationDemo] Helmet already loading...');
      return;
    }

    if (this.helmetModel) {
      console.log('[AnimationDemo] Helmet already loaded');
      if (callback) callback(this.helmetModel);
      return;
    }

    this.isLoadingHelmet = true;
    console.log('[AnimationDemo] Loading helmet model...');

    this.loader.load(
      '/assets/models/DamagedHelmet.glb',
      (gltf) => {
        console.log('[AnimationDemo] Helmet model loaded successfully');
        this.helmetModel = gltf.scene;
        // Note: Materials will be automatically patched by BaseScene when _sceneDirty is set
        this.isLoadingHelmet = false;
        if (callback) callback(this.helmetModel);
      },
      (progress) => {
        console.log(`[AnimationDemo] Loading helmet: ${(progress.loaded / progress.total * 100).toFixed(2)}%`);
      },
      (error) => {
        console.error('[AnimationDemo] Error loading helmet model:', error);
        this.isLoadingHelmet = false;
      }
    );
  }

  init() {
    this.createSceneObjects();
    this._disableEnvOnGround();
  }

  initLights() {
    this.loadPreset('discoModel');

    this.lightsSystem.setLODBias(this.params.lodBias);
    this.lightsSystem.setDynamicClusters(this.params.dynamicClusters);

    // Defer light source visualization to avoid blocking during scene switch
    if (this.showLightMarkers) {
      requestAnimationFrame(() => {
        if (this.active && this.lightMarkers) {
          this.lightMarkers.init(this.scene);
        }
      });
    }
  }

  createSceneObjects() {
    // Normal scene objects
    const boxGeometry = new BoxGeometry(4, 4, 4);
    const boxMaterial = new MeshStandardMaterial({ color: 'white', metalness: 0.5, roughness: 0.5 });
    const box = new Mesh(boxGeometry, boxMaterial);
    box.position.set(0, 2, 0);
    this.sceneObjects.box = box;
    this.scene.add(box);

    const torusGeometry = new TorusGeometry(3, 1, 32, 64);
    const torusMaterial = new MeshStandardMaterial({ color: 'gold', metalness: 0.8, roughness: 0.2 });
    const torus = new Mesh(torusGeometry, torusMaterial);
    torus.position.set(-10, 3, 0);
    torus.rotation.set(Math.PI / 4, 0, 0);
    this.sceneObjects.torus = torus;
    this.scene.add(torus);

    const sphereGeometry = new SphereGeometry(2.5);
    const sphereMaterial = new MeshStandardMaterial({ color: 'white', metalness: 0, roughness: 1 });
    const sphere = new Mesh(sphereGeometry, sphereMaterial);
    sphere.position.set(10, 2, 0);
    this.sceneObjects.sphere = sphere;
    this.scene.add(sphere);

    // Material test spheres
    const spheres = [];
    const roughnessValues = [1, 0.5, 0.2, 0];
    const metalnessValues = [0, 0, 0.5, 1];

    for (let i = 0; i < 4; i++) {
      const sg = new SphereGeometry(1.5);
      const sm = new MeshStandardMaterial({
        color: 'white',
        metalness: metalnessValues[i],
        roughness: roughnessValues[i]
      });
      const s = new Mesh(sg, sm);
      s.position.set(i * 4 - 6, 2, -10);
      spheres.push(s);
      this.scene.add(s);
    }
    this.sceneObjects.testSpheres = spheres;

    // Ground
    const groundGeometry = new PlaneGeometry(100, 100);
    const groundMaterial = new MeshStandardMaterial({ color: 0x202020, roughness: 0.6, metalness: 0.3, envMapIntensity: 0 });
    const ground = new Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    this.sceneObjects.ground = ground;
    this.scene.add(ground);
  }

  _disableEnvOnGround() {
    const ground = this.sceneObjects && this.sceneObjects.ground;
    if (!ground || !ground.material) return;
    // Ensure environment reflections are fully disabled on the ground
    ground.material.envMapIntensity = 0;
    ground.material.envMap = null; // opt-out from scene.environment fallback
    ground.material.needsUpdate = true;
  }

  createPerformanceScene() {
    // Clear normal objects
    Object.values(this.sceneObjects).forEach(obj => {
      if (Array.isArray(obj)) {
        obj.forEach(o => this.scene.remove(o));
      } else {
        this.scene.remove(obj);
      }
    });

    // Performance test ground
    const groundGeometry = new BoxGeometry(200, 0.1, 200);
    const groundMaterial = new MeshStandardMaterial({ color: 0x111111 });
    const ground = new Mesh(groundGeometry, groundMaterial);
    ground.position.y = -0.05;
    this.scene.add(ground);
    this.sceneObjects.perfGround = ground;

    // Grid of geometry
    const boxes = [];
    for (let i = 0; i < 100; i++) {
      const x = (i % 10 - 5) * 15;
      const z = (Math.floor(i / 10) - 5) * 15;
      const boxGeometry = new BoxGeometry(5, 10, 5);
      const boxMaterial = new MeshStandardMaterial({ color: 'white', metalness: 0.3, roughness: 0.7 });
      const box = new Mesh(boxGeometry, boxMaterial);
      box.position.set(x, 5, z);
      boxes.push(box);
      this.scene.add(box);
    }
    this.sceneObjects.perfBoxes = boxes;

    // Update camera
    this.camera.position.set(50, 30, 50);
    this.controls.target.set(0, 5, 0);
    this.controls.maxDistance = 1200;
    this.controls.update();
  }

  restoreNormalScene() {
    // Remove performance objects
    if (this.sceneObjects.perfGround) {
      this.scene.remove(this.sceneObjects.perfGround);
      delete this.sceneObjects.perfGround;
    }
    if (this.sceneObjects.perfBoxes) {
      this.sceneObjects.perfBoxes.forEach(box => this.scene.remove(box));
      delete this.sceneObjects.perfBoxes;
    }

    // Remove disco model specific objects
    if (this.sceneObjects.discoModelSpheres) {
      this.sceneObjects.discoModelSpheres.forEach(sphere => {
        this.scene.remove(sphere);
        if (sphere.geometry) sphere.geometry.dispose();
        if (sphere.material) sphere.material.dispose();
      });
      delete this.sceneObjects.discoModelSpheres;
    }
    if (this.sceneObjects.discoHelmet) {
      this.scene.remove(this.sceneObjects.discoHelmet);
      delete this.sceneObjects.discoHelmet;
    }

    // Restore normal objects
    Object.values(this.sceneObjects).forEach(obj => {
      if (Array.isArray(obj)) {
        obj.forEach(o => this.scene.add(o));
      } else {
        this.scene.add(obj);
      }
    });

    // Re-apply ground env disable after re-adding objects and potential material patching
    this._disableEnvOnGround();

    // Reset camera
    this.camera.position.set(40, 30, 40);
    this.controls.target.set(0, 20, 0);
    this.controls.maxDistance = 200;
    this.controls.update();
  }

  loadPreset(presetType) {
    this.params.preset = presetType;
    this.lightsSystem.clearLights();

    let lights = [];

    switch (presetType) {
      case 'showcase':
        this.isPerformanceTest = false;
        this.restoreNormalScene();
        lights.push(
          {
            type: 'point',
            position: new Vector3(-8, 3, -8),
            color: new Color('#ff6600'),
            intensity: 20,
            radius: 10,
            animation: { circular: { speed: 1, radius: 2 } }
          },
          {
            type: 'point',
            position: new Vector3(0, 3, -8),
            color: new Color('#00ff00'),
            intensity: 20,
            radius: 10,
            animation: { pulse: { speed: 1, amount: 0.1, target: PulseTarget.INTENSITY } }
          },
          {
            type: 'point',
            position: new Vector3(8, 2, -8),
            color: new Color('#ff8800'),
            intensity: 15,
            radius: 8,
            animation: { flicker: { speed: 12, intensity: 0.4 } }
          },
          {
            type: 'spot',
            position: new Vector3(0, 8, 0),
            direction: new Vector3(0, -1, 0),
            angle: Math.PI / 6,
            penumbra: 0.2,
            color: new Color('#ffffff'),
            intensity: 3,
            radius: 20,
            animation: { rotation: { axis: [0, 1, 0], speed: 0.5, mode: 'continuous' } }
          },
          {
            type: 'rect',
            position: new Vector3(0, 9.5, 0),
            width: 8,
            height: 8,
            normal: new Vector3(0, -1, 0),
            color: new Color('#ff00ff'),
            intensity: 50,
            radius: 20,
            animation: { pulse: { speed: 1.7, amount: 0.01, target: PulseTarget.INTENSITY } }
          }
        );
        break;

      case 'fireflies':
        this.isPerformanceTest = false;
        this.restoreNormalScene();
        for (let i = 0; i < 20; i++) {
          lights.push({
            type: 'point',
            position: new Vector3(
              Math.random() * 30 - 15,
              Math.random() * 5 + 1,
              Math.random() * 30 - 15
            ),
            color: new Color().setHSL(0.15, 0.8, 0.6),
            intensity: 5,
            radius: 4,
            animation: {
              wave: {
                axis: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5],
                speed: 0.5 + Math.random(),
                amplitude: 1 + Math.random()
              },
              pulse: {
                speed: 0.2 + Math.random() * 0.5,
                amount: 0.5,
                target: PulseTarget.INTENSITY
              }
            }
          });
        }
        break;

      case 'disco':
        this.isPerformanceTest = false;
        this.restoreNormalScene();
        const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff','#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          lights.push({
            type: 'spot',
            position: new Vector3(Math.cos(angle) * 10, 7+(i*0.5), Math.sin(angle) * 10),
            direction: new Vector3(-Math.cos(angle), 1, -Math.sin(angle)).normalize(),
            angle: Math.PI / 4,
            penumbra: 0.5,
            decay: 0.1*i+0.5,
            color: new Color(colors[i]),
            intensity: 1+5*i,
            radius: 1+5*i,
            animation: {
              rotation: {
                axis: [0, 1, 0],
                speed: 1 + i * 0.1,
                mode: 'continuous'
              },
              wave:{
                axis: [0, 1, 0],
                speed: 1 + i * 0.1,
                amplitude: 1 + i * 0.1,
                phase: 0
              }
            }
          });
        }
        break;

      case 'discoModel':
        this.isPerformanceTest = false;
        this.restoreNormalScene();

        // Remove box, torus, sphere, and test spheres - only keep ground
        if (this.sceneObjects.box) {
          this.scene.remove(this.sceneObjects.box);
        }
        if (this.sceneObjects.torus) {
          this.scene.remove(this.sceneObjects.torus);
        }
        if (this.sceneObjects.sphere) {
          this.scene.remove(this.sceneObjects.sphere);
        }
        if (this.sceneObjects.testSpheres) {
          this.sceneObjects.testSpheres.forEach(sphere => this.scene.remove(sphere));
        }

        // Create circle of spheres with different roughness/metalness around center
        const numSpheres = 8;
        const circleRadius = 24;
        const sphereMaterialProps = [
          { roughness: 0, metalness: 1 },    // Very metallic, smooth
          { roughness: 0.2, metalness: 0.8 },
          { roughness: 0.4, metalness: 0.6 },
          { roughness: 0.6, metalness: 0.4 },
          { roughness: 0.8, metalness: 0.2 },
          { roughness: 1, metalness: 0 },     // Very rough, non-metallic
          { roughness: 0.5, metalness: 0.5 }, // Middle ground
          { roughness: 0.3, metalness: 0.9 }  // Almost chrome
        ];

        this.sceneObjects.discoModelSpheres = [];
        for (let i = 0; i < numSpheres; i++) {
          const angle = (i / numSpheres) * Math.PI * 2;
          const sg = new SphereGeometry(1.5);
          const props = sphereMaterialProps[i];
          const sm = new MeshStandardMaterial({
            color: 'white',
            metalness: props.metalness,
            roughness: props.roughness
          });
          const s = new Mesh(sg, sm);
          s.position.set(
            Math.cos(angle) * circleRadius,
            2,
            Math.sin(angle) * circleRadius
          );
          this.sceneObjects.discoModelSpheres.push(s);
          this.scene.add(s);
        }

        // Mark scene as dirty so BaseScene will patch materials
        this._sceneDirty = true;

        // Load and add helmet model to center
        this.loadHelmetModel((helmetScene) => {
          // Remove any existing helmet
          if (this.sceneObjects.discoHelmet) {
            this.scene.remove(this.sceneObjects.discoHelmet);
          }

          // Clone the helmet model
          const helmet = helmetScene.clone();
          helmet.position.set(0, 25, 0);
          helmet.scale.set(15, 15, 15);

          // Rotate helmet to match Grid demo orientation (X: PI/2, Y: 0, Z: 0)
          helmet.rotation.set(0,  Math.PI / 2,0);

          this.sceneObjects.discoHelmet = helmet;
          this.scene.add(helmet);

          // Mark scene as dirty so BaseScene will patch helmet materials on next render
          this._sceneDirty = true;

          console.log('[AnimationDemo] Helmet added to disco model scene');
        });

        // Create disco lights similar to disco preset (2x radius)
        const discoColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff','#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          lights.push({
            type: 'spot',
            position: new Vector3(Math.cos(angle) * 20, 14+(i*1.0), Math.sin(angle) * 20),
            direction: new Vector3(-Math.cos(angle), 1, -Math.sin(angle)).normalize(),
            angle: Math.PI / 4,
            penumbra: 0.5,
            decay: 0.1*i+0.5,
            color: new Color(discoColors[i]),
            intensity: 1+5*i,
            radius: 1+5*i,
            animation: {
              rotation: {
                axis: [0, 1, 0],
                speed: 1 + i * 0.1,
                mode: 'continuous'
              },
              wave:{
                axis: [0, 1, 0],
                speed: 1 + i * 0.1,
                amplitude: 1 + i * 0.1,
                phase: 0
              }
            }
          });
        }

        // Add thousands of small point lights flying in circles around the helmet
        const numParticleLights = 1000;
        for (let i = 0; i < numParticleLights; i++) {
          // Random radius between 5 and 18 units
          const particleCircleRadius = 5 + Math.random() * 13;

          // Random height between 0 and 40
          const baseHeight = Math.random() * 40;

          // Random starting angle
          const startAngle = Math.random() * Math.PI * 2;

          // Initial position on circle
          const x = Math.cos(startAngle) * particleCircleRadius;
          const z = Math.sin(startAngle) * particleCircleRadius;

          // Random speed (some fast, some slow, some reverse)
          const speed = (Math.random() * 2 - 0.5) * 0.8; // Range: -0.4 to 1.2

          // Random color with good saturation
          const hue = Math.random();
          const lightColor = new Color().setHSL(hue, 0.8, 0.6);

          lights.push({
            type: 'point',
            position: new Vector3(x, baseHeight, z),
            color: lightColor,
            intensity: 2 + Math.random() * 3,
            radius: 3 + Math.random() * 3,
            decay: 2.0,
            animation: {
              circular: {
                speed: speed,
                radius: particleCircleRadius
              },
              pulse: {
                speed: 0.5 + Math.random() * 1.5,
                amount: 0.3 + Math.random() * 0.4,
                target: PulseTarget.INTENSITY
              }
            }
          });
        }
        break;
    }

    // Use bulk config for maximum performance
    this.lightsSystem.bulkConfigLights(lights, false);

    // Update stats display directly (no polling needed)
    this.lightCountDisplay.total = lights.length;
    this.lightCountDisplay.animated = lights.filter(l => l.animation).length;
    this.lightCountDisplay.static = lights.length - this.lightCountDisplay.animated;
    if (this.showLightMarkers && this.lightMarkers) {
      this.lightMarkers.reinit(this.scene);
    }
    this.params.showLightMarkers = true;

    // Ensure environment is disabled on ground after any preset/material changes
    this._disableEnvOnGround();
  }

  createUI(pane) {
    const folder = pane.addFolder({ title: 'Animation Demo', expanded: true });
    this.mainFolder = folder;

    // Create initial lights list
    const lights = this.lightsSystem.exportLights();
    this.lightsFolder = folder.addFolder({ title: `Lights (${lights.length})`, expanded: false });

    // Skip rendering individual light buttons if there are too many (performance)
    if (lights.length > 100) {
      this.lightsFolder.addBlade({
        view: 'text',
        label: 'Note',
        parse: (v) => String(v),
        value: `Too many lights (${lights.length}) to list individually`
      }).disabled = true;
    } else {
      lights.forEach((light, i) => {
        const animKeys = light.animation ? Object.keys(light.animation).join(', ') : 'static';
        const lightBtn = this.lightsFolder.addButton({
          title: `${light.type.charAt(0).toUpperCase() + light.type.slice(1)} ${i + 1} [${animKeys}]`
        });

        lightBtn.on('click', () => {
          this.selectLight(i);
        });
      });
    }

    // Presets
    folder.addBlade({
      view: 'list',
      label: 'Preset',
      options: [
        { text: 'Disco Model', value: 'discoModel' },
        { text: 'Disco', value: 'disco' },
        { text: 'Showcase', value: 'showcase' },
        { text: 'Fireflies', value: 'fireflies' },
      ],
      value: this.params.preset
    }).on('change', (ev) => {
      this.loadPreset(ev.value);
      this.updateLightsList();
    });

    // Performance settings
    const perfFolder = folder.addFolder({ title: 'Performance', expanded: false });

    perfFolder.addBinding(this.params, 'lodBias', {
      label: 'LOD Bias',
      min: 0.1,
      max: 3,
      step: 0.1
    }).on('change', (ev) => {
      this.lightsSystem.setLODBias(ev.value);
    });

    perfFolder.addBinding(this.params, 'dynamicClusters', { label: 'Dynamic Clusters' })
      .on('change', (ev) => {
        this.lightsSystem.setDynamicClusters(ev.value);
      });

    // Light Visualization
    const visFolder = folder.addFolder({ title: 'Light Visualization', expanded: false });

    visFolder.addBinding(this.params, 'showLightMarkers', { label: 'Show Sources' })
      .on('change', (ev) => {
        this.lightMarkers.setVisible(ev.value);
      });

    visFolder.addBinding(this.params, 'showGlow', { label: 'Show Glow' })
      .on('change', (ev) => {
        this.lightMarkers.setShowGlow(ev.value);
      });

    visFolder.addBinding(this.params, 'glowRadius', {
      label: 'Glow Radius',
      min: 0.1,
      max: 2.0,
      step: 0.1
    }).on('change', (ev) => {
      this.lightMarkers.setGlowRadius(ev.value);
    });

    // Add Animated Light buttons
    const addFolder = folder.addFolder({ title: 'Add Animated Light', expanded: false });

    addFolder.addButton({ title: 'Circular Motion' }).on('click', () => {
      this.addAnimatedLight('circular');
    });

    addFolder.addButton({ title: 'Linear Motion' }).on('click', () => {
      this.addAnimatedLight('linear');
    });

    addFolder.addButton({ title: 'Wave Motion' }).on('click', () => {
      this.addAnimatedLight('wave');
    });

    addFolder.addButton({ title: 'Flickering' }).on('click', () => {
      this.addAnimatedLight('flicker');
    });

    addFolder.addButton({ title: 'Pulsing' }).on('click', () => {
      this.addAnimatedLight('pulse');
    });

    addFolder.addButton({ title: 'Rotating Spot' }).on('click', () => {
      this.addAnimatedLight('rotating-spot');
    });

    addFolder.addButton({ title: 'Pulsing Rect' }).on('click', () => {
      this.addAnimatedLight('pulsing-rect');
    });

    addFolder.addButton({ title: 'Combined' }).on('click', () => {
      this.addAnimatedLight('combined');
    });

    // Clear all lights button
    folder.addButton({ title: 'Clear All Lights' }).on('click', () => {
      this.lightsSystem.clearLights();
      this.lightsList = [];
      this.selectedLightIndex = null;

      // Reset stats
      this.lightCountDisplay.total = 0;
      this.lightCountDisplay.animated = 0;
      this.lightCountDisplay.static = 0;

      // Clear light source visualization
      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }

      // Clear animation controls folder
      if (this.animControlsFolder && !this.animControlsFolder.disposed) {
        this.animControlsFolder.dispose();
        this.animControlsFolder = null;
      }

      this.updateLightsList();
    });
  }

  render() {
    // Animate helmet floating if it exists
    if (this.sceneObjects.discoHelmet) {
      this.helmetFloatTime += 0.016; // Approximate delta time
      const floatOffset = Math.sin(this.helmetFloatTime * 1.5) * 0.5; // Float up and down 0.5 units
      this.sceneObjects.discoHelmet.position.y = 20 + floatOffset;

      // Also add a gentle rotation
      this.sceneObjects.discoHelmet.rotation.y += 0.005;
    }

    // Call parent render method
    super.render();
  }

  dispose() {
    super.dispose();

    Object.values(this.sceneObjects).forEach(obj => {
      if (Array.isArray(obj)) {
        obj.forEach(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      } else {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      }
    });
  }
}
