// LightTypesScene.js - Showcase different light types with full interactive controls
import { Vector3, Color, TorusGeometry, MeshStandardMaterial, Mesh, BoxGeometry, SphereGeometry, PlaneGeometry, MathUtils } from 'three';
import { BaseScene } from './BaseScene.js';
import { PulseTarget } from '../../lib/index.js';

export class LightTypesScene extends BaseScene {
  constructor(renderer, lightsSystem) {
    super(renderer, lightsSystem, {
      cameraPosition: new Vector3(1.18, 24.56, -19.20),
      controlsTarget: new Vector3(1.06, 2.32, 0.38),
      maxDistance: 500,
      minDistance: 5,
      showLightMarkers: true,
      showGlow: true,
      pointGlowRadius: 0.5,
      spotGlowRadius: 0.5,
      rectGlowRadius: 0.5
    });

    this.params = {
      addLightType: 'point',
      lodBias: 1.0,
      showLightMarkers: true,
      showGlow: true,
      glowRadius: 0.5,
      showAnimations: false
    };

    this.selectedLightIndex = null;
    this.selectedLightData = null;
    this.animatedObjects = [];
    this.mainFolder = null;
    this.lightsListFolder = null;
    this.selectedLightFolder = null;
    this.animationControlsFolder = null;
    
    // Stats for display
    this.stats = {
      totalLights: 0,
      pointLights: 0,
      spotLights: 0,
      rectLights: 0
    };
  }

  getSceneInfo() {
    return {
      title: 'Light Types Demo',
      content: `
        <p>Showcase all supported light types with full interactive controls. Add point, spot, and rectangle lights, then customize each property.</p>
        
        <h3>Light Types</h3>
        <ul>
          <li><strong>Point</strong> - omnidirectional light source</li>
          <li><strong>Spot</strong> - directional cone of light</li>
          <li><strong>Rectangle</strong> - area light with size and rotation</li>
        </ul>
        
        <h3>Features</h3>
        <ul>
          <li>Add any combination of light types</li>
          <li>Click a light to select and edit all properties</li>
          <li>Add animations to any light</li>
          <li>Test materials with varying roughness/metalness</li>
          <li>Load animated preset with all three types</li>
        </ul>
      `
    };
  }

  getStatsBindings() {
    return [
      { object: this.stats, property: 'totalLights', label: '💡 Total Lights' },
      { object: this.stats, property: 'pointLights', label: 'Point' },
      { object: this.stats, property: 'spotLights', label: 'Spot' },
      { object: this.stats, property: 'rectLights', label: 'Rect' }
    ];
  }

  init() {
    // Add animated objects
    const torusGeometry = new TorusGeometry(2, 0.8, 32, 64);
    const torusMaterial = new MeshStandardMaterial({ color: 'gold', metalness: 0.8, roughness: 0.2 });
    const torus = new Mesh(torusGeometry, torusMaterial);
    torus.position.set(-10, 3, 0);
    this.scene.add(torus);
    this.animatedObjects.push({ mesh: torus, rotSpeed: { x: 0.5, y: 0.3 } });

    const boxGeometry = new BoxGeometry(3, 3, 3);
    const boxMaterial = new MeshStandardMaterial({ color: 'royalblue', metalness: 0.6, roughness: 0.3 });
    const box = new Mesh(boxGeometry, boxMaterial);
    box.position.set(10, 3, 0);
    this.scene.add(box);
    this.animatedObjects.push({ mesh: box, rotSpeed: { y: 0.4 } });

    // Material test spheres
    const roughnessValues = [1, 0.5, 0.2, 0];
    const metalnessValues = [0, 0, 0.5, 1];

    for (let i = 0; i < 4; i++) {
      const sphereGeometry = new SphereGeometry(1.5);
      const sphereMaterial = new MeshStandardMaterial({
        color: 'white',
        metalness: metalnessValues[i],
        roughness: roughnessValues[i]
      });
      const sphere = new Mesh(sphereGeometry, sphereMaterial);
      sphere.position.set(i * 4 - 6, 2, -8);
      this.scene.add(sphere);
    }

    // Architectural elements
    const walls = [
      { args: [30, 10, 0.5], position: [0, 5, -15] },
      { args: [30, 10, 0.5], position: [0, 5, 15] },
      { args: [0.5, 10, 30], position: [-15, 5, 0] },
      { args: [0.5, 10, 30], position: [15, 5, 0] }
    ];

    walls.forEach((wall, i) => {
      const geometry = new BoxGeometry(...wall.args);
      const material = new MeshStandardMaterial({
        color: i < 2 ? 0xf0f0f0 : 0xe0e0e0
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(...wall.position);
      this.scene.add(mesh);
    });

    // Columns
    [-10, -5, 5, 10].forEach(x => {
      const geometry = new BoxGeometry(1, 8, 1);
      const material = new MeshStandardMaterial({ color: 0xd0d0d0 });
      const column = new Mesh(geometry, material);
      column.position.set(x, 4, -10);
      this.scene.add(column);
    });

    // Floor
    const groundGeometry = new PlaneGeometry(50, 50);
    const groundMaterial = new MeshStandardMaterial({ color: 0x303030 });
    const ground = new Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
  }

  initLights() {
    // Clear previous scene's lights (reuses pre-allocated WASM memory)
    this.lightsSystem.clearLights();

    // Set scene-specific LOD bias
    this.lightsSystem.setLODBias(this.params.lodBias);

    // Add initial example lights
    this.loadInitialLights();

    // Defer light source visualization to avoid blocking during scene switch
    if (this.showLightMarkers) {
      requestAnimationFrame(() => {
        if (this.active && this.lightMarkers) {
          this.lightMarkers.init(this.scene);
        }
      });
    }
  }

  loadInitialLights() {
    // Animated point light
    this.lightsSystem.addLight({
      type: 'point',
      position: new Vector3(-8, 4, -8),
      color: new Color(1, 0.6, 0.2),
      intensity: 15,
      radius: 12,
      decay: 2,
      animation: {
        circular: { speed: 0.5, radius: 2 },
        pulse: { speed: 2, amount: 0.2, target: PulseTarget.INTENSITY }
      }
    });

    // Static point light
    this.lightsSystem.addLight({
      type: 'point',
      position: new Vector3(8, 4, -8),
      color: new Color(0.2, 0.6, 1),
      intensity: 15,
      radius: 12,
      decay: 2
    });

  
    // Static spot light
    this.lightsSystem.addLight({
      type: 'spot',
      position: new Vector3(-13.5, 2, 13),
      color: new Color(1, 0.2, 0.2),
      intensity: 25,
      radius: 18,
      decay: 2,
      direction: new Vector3(0.5, -0.7, -0.5).normalize(),
      angle: Math.PI / 2,
      penumbra: 0.3
    });

    // Animated rect area light
    this.lightsSystem.addLight({
      type: 'rect',
      position: new Vector3(0.9, 8, 10.5),
      color: new Color(0.8, 0.4, 0.3),
      intensity: 30,
      width: 10,
      height: 5,
      normal: new Vector3(0, -0.3, -1.0),
      decay: 1.6,
      radius: 20});
  }

  addLight(type) {
    const basePos = new Vector3(
      MathUtils.randFloatSpread(20),
      MathUtils.randFloat(2, 8),
      MathUtils.randFloatSpread(20)
    );

    let newLight;

    switch(type) {
      case 'point':
        newLight = {
          type: 'point',
          position: basePos,
          color: new Color().setHSL(Math.random(), 0.7, 0.5),
          intensity: MathUtils.randFloat(5, 20),
          radius: MathUtils.randFloat(8, 15),
          decay: 2
        };
        break;

      case 'spot':
        newLight = {
          type: 'spot',
          position: basePos,
          color: new Color().setHSL(Math.random(), 0.7, 0.5),
          intensity: MathUtils.randFloat(10, 30),
          radius: MathUtils.randFloat(15, 25),
          decay: 2,
          direction: new Vector3(0, -1, 0).add(
            new Vector3(
              MathUtils.randFloatSpread(0.5),
              0,
              MathUtils.randFloatSpread(0.5)
            )
          ).normalize(),
          angle: MathUtils.randFloat(Math.PI / 8, Math.PI / 3),
          penumbra: MathUtils.randFloat(0, 0.5)
        };
        break;

      case 'rect':
        const rectPos = new Vector3(
          MathUtils.randFloatSpread(15),
          MathUtils.randFloat(3, 8),
          MathUtils.randFloatSpread(15)
        );
        const toCenter = new Vector3(0, 2, 0).sub(rectPos).normalize();
        const rectWidth = MathUtils.randFloat(3, 8);
        const rectHeight = MathUtils.randFloat(3, 8);

        newLight = {
          type: 'rect',
          position: rectPos,
          color: new Color().setHSL(Math.random(), 0.7, 0.6),
          intensity: MathUtils.randFloat(30, 60),
          width: rectWidth,
          height: rectHeight,
          normal: toCenter,
          decay: MathUtils.randFloat(0.1, 1.0),
          radius: Math.max(rectWidth, rectHeight) * 3
        };
        break;
    }

    this.lightsSystem.addLight(newLight);

    // Reinitialize light sources
    if (this.lightMarkers) {
      this.lightMarkers.reinit(this.scene);
    }

    this.updateLightsList();
  }

  loadAnimatedPreset() {
    this.lightsSystem.clearLights();

    // Add animated lights preset (from React version)
    const lights = [
      // Animated point with circular + pulse
      {
        type: 'point',
        position: new Vector3(0, 5, 0),
        color: new Color(1, 0.5, 0),
        intensity: 20,
        radius: 15,
        decay: 2,
        animation: {
          circular: { speed: 1, radius: 5 },
          pulse: { speed: 2, amount: 0.3, target: PulseTarget.INTENSITY }
        }
      },
      // Flickering fire lights
      ...[-5, 0, 5].map((x, i) => ({
        type: 'point',
        position: new Vector3(x, 1, -10),
        color: new Color(1, 0.6, 0.2),
        intensity: 15,
        radius: 8,
        decay: 2,
        animation: {
          flicker: {
            speed: 10 + i * 2,
            intensity: 0.3,
            seed: i * 100
          }
        }
      })),
      // Rotating spot light
      {
        type: 'spot',
        position: new Vector3(10, 8, 0),
        color: new Color(0, 0.5, 1),
        intensity: 30,
        radius: 20,
        decay: 2,
        direction: new Vector3(-1, -1, 0).normalize(),
        angle: Math.PI / 6,
        penumbra: 0.2,
        animation: {
          rotation: {
            axis: [0, 1, 0],
            speed: 0.5,
            mode: 'continuous'
          }
        }
      },
      // Pulsing rect light
      {
        type: 'rect',
        position: new Vector3(-14.5, 6, 0),
        color: new Color(1, 0, 1),
        intensity: 50,
        width: 4,
        height: 8,
        normal: new Vector3(1, 0, 0),
        decay: 0.5,
        radius: 30,
        animation: {
          pulse: {
            speed: 1,
            amount: 0.5,
            target: PulseTarget.INTENSITY
          }
        }
      },
      // Moving spot light
      {
        type: 'spot',
        position: new Vector3(-10, 6, -10),
        color: new Color(0, 1, 0),
        intensity: 25,
        radius: 18,
        decay: 2,
        direction: new Vector3(0, -1, 0),
        angle: Math.PI / 4,
        penumbra: 0.1,
        animation: {
          linear: {
            to: new Vector3(10, 6, 10),
            duration: 8,
            mode: 'pingpong'
          }
        }
      }
    ];

    lights.forEach(light => this.lightsSystem.addLight(light));

    // Reinitialize light sources
    if (this.lightMarkers) {
      this.lightMarkers.reinit(this.scene);
    }

    this.updateLightsList();
  }

  updateLightsList() {
    if (!this.lightsListFolder) return;

    if (this.lightsListFolder && !this.lightsListFolder.disposed) {
      this.lightsListFolder.dispose();
    }

    const lights = this.lightsSystem.exportLights();
    this.lightsListFolder = this.mainFolder.addFolder({
      title: `Lights (${lights.length})`,
      expanded: true
    });

    lights.forEach((light, i) => {
      const lightBtn = this.lightsListFolder.addButton({
        title: `${light.type.charAt(0).toUpperCase() + light.type.slice(1)} ${i + 1}${light.animation ? ' (anim)' : ''}`
      });

      lightBtn.on('click', () => {
        this.selectLight(i);
      });
    });
  }

  selectLight(index) {
    this.selectedLightIndex = index;
    const lights = this.lightsSystem.exportLights();
    this.selectedLightData = lights[index];
    this.updateSelectedLightControls();
  }

  updateSelectedLightControls() {
    // Remove existing folder
    if (this.selectedLightFolder && !this.selectedLightFolder.disposed) {
      this.selectedLightFolder.dispose();
      this.selectedLightFolder = null;
    }

    if (this.selectedLightIndex === null) return;

    // Get fresh light data from the system instead of using stale cache
    const lights = this.lightsSystem.exportLights();
    const light = lights[this.selectedLightIndex];
    if (!light) return;

    // Update the cached data for next time
    this.selectedLightData = light;
    this.selectedLightFolder = this.mainFolder.addFolder({
      title: `${light.type.charAt(0).toUpperCase() + light.type.slice(1)} Light ${this.selectedLightIndex + 1}`,
      expanded: true
    });

    // Animation controls toggle
    this.selectedLightFolder.addBinding(this.params, 'showAnimations', {
      label: 'Show Animations'
    }).on('change', () => {
      this.updateSelectedLightControls();
    });

    if (this.params.showAnimations) {
      this.addAnimationControls();
    }

    // Color
    const colorParams = {
      color: `#${light.color.getHexString()}`
    };
    this.selectedLightFolder.addBinding(colorParams, 'color', {
      label: 'Color'
    }).on('change', (ev) => {
      this.lightsSystem.updateLightColor(this.selectedLightIndex, new Color(ev.value));
    });

    // Intensity
    const intensityParams = { intensity: light.intensity };
    this.selectedLightFolder.addBinding(intensityParams, 'intensity', {
      label: 'Intensity',
      min: 0,
      max: light.type === 'rect' ? 100 : 50,
      step: 0.5
    }).on('change', (ev) => {
      this.lightsSystem.updateLightIntensity(this.selectedLightIndex, ev.value);
    });

    // Type-specific controls
    if (light.type === 'point' || light.type === 'spot') {
      const radiusParams = { radius: light.radius };
      this.selectedLightFolder.addBinding(radiusParams, 'radius', {
        label: 'Radius',
        min: 1,
        max: 30,
        step: 0.5
      }).on('change', (ev) => {
        this.lightsSystem.updateLightRadius(this.selectedLightIndex, ev.value);
      });

      const decayParams = { decay: light.decay };
      this.selectedLightFolder.addBinding(decayParams, 'decay', {
        label: 'Decay',
        min: 0.5,
        max: 3,
        step: 0.1
      }).on('change', (ev) => {
        this.lightsSystem.updateLightDecay(this.selectedLightIndex, ev.value);
      });
    }

    if (light.type === 'spot') {
      const angleParams = { angle: light.angle * 180 / Math.PI };
      this.selectedLightFolder.addBinding(angleParams, 'angle', {
        label: 'Angle (degrees)',
        min: 5,
        max: 90,
        step: 1
      }).on('change', (ev) => {
        const radians = ev.value * Math.PI / 180;
        this.lightsSystem.updateSpotAngle(this.selectedLightIndex, radians, light.penumbra);
      });

      const penumbraParams = { penumbra: light.penumbra };
      this.selectedLightFolder.addBinding(penumbraParams, 'penumbra', {
        label: 'Penumbra',
        min: 0,
        max: light.angle * 0.99,
        step: 0.01
      }).on('change', (ev) => {
        this.lightsSystem.updateSpotAngle(this.selectedLightIndex, light.angle, ev.value);
      });
    }

    if (light.type === 'rect') {
      const widthParams = { width: light.width };
      this.selectedLightFolder.addBinding(widthParams, 'width', {
        label: 'Width',
        min: 1,
        max: 20,
        step: 0.5
      }).on('change', (ev) => {
        const currentLights = this.lightsSystem.exportLights();
        const currentLight = currentLights[this.selectedLightIndex] || light;
        const updatedHeight = currentLight?.height ?? light.height;
        this.lightsSystem.updateRectSize(this.selectedLightIndex, ev.value, updatedHeight);
        light.width = ev.value;
      });

      const heightParams = { height: light.height };
      this.selectedLightFolder.addBinding(heightParams, 'height', {
        label: 'Height',
        min: 1,
        max: 20,
        step: 0.5
      }).on('change', (ev) => {
        const currentLights = this.lightsSystem.exportLights();
        const currentLight = currentLights[this.selectedLightIndex] || light;
        const updatedWidth = currentLight?.width ?? light.width;
        this.lightsSystem.updateRectSize(this.selectedLightIndex, updatedWidth, ev.value);
        light.height = ev.value;
      });

      const decayParams = { decay: light.decay };
      this.selectedLightFolder.addBinding(decayParams, 'decay', {
        label: 'Decay',
        min: 0,
        max: 2,
        step: 0.05
      }).on('change', (ev) => {
        this.lightsSystem.updateLightDecay(this.selectedLightIndex, ev.value);
      });

      const radiusParams = { radius: light.radius };
      this.selectedLightFolder.addBinding(radiusParams, 'radius', {
        label: 'Radius',
        min: 5,
        max: 50,
        step: 0.5
      }).on('change', (ev) => {
        this.lightsSystem.updateLightRadius(this.selectedLightIndex, ev.value);
      });

      // Normal direction controls
      const normalFolder = this.selectedLightFolder.addFolder({
        title: 'Normal Direction',
        expanded: false
      });

      const normalX = { x: light.normal.x };
      normalFolder.addBinding(normalX, 'x', {
        label: 'X',
        min: -1,
        max: 1,
        step: 0.1
      }).on('change', (ev) => {
        const currentLights = this.lightsSystem.exportLights();
        const currentLight = currentLights[this.selectedLightIndex];
        const newNormal = currentLight.normal.clone();
        newNormal.x = ev.value;
        newNormal.normalize();
        this.lightsSystem.updateRectNormal(this.selectedLightIndex, newNormal);
      });

      const normalY = { y: light.normal.y };
      normalFolder.addBinding(normalY, 'y', {
        label: 'Y',
        min: -1,
        max: 1,
        step: 0.1
      }).on('change', (ev) => {
        const currentLights = this.lightsSystem.exportLights();
        const currentLight = currentLights[this.selectedLightIndex];
        const newNormal = currentLight.normal.clone();
        newNormal.y = ev.value;
        newNormal.normalize();
        this.lightsSystem.updateRectNormal(this.selectedLightIndex, newNormal);
      });

      const normalZ = { z: light.normal.z };
      normalFolder.addBinding(normalZ, 'z', {
        label: 'Z',
        min: -1,
        max: 1,
        step: 0.1
      }).on('change', (ev) => {
        const currentLights = this.lightsSystem.exportLights();
        const currentLight = currentLights[this.selectedLightIndex];
        const newNormal = currentLight.normal.clone();
        newNormal.z = ev.value;
        newNormal.normalize();
        this.lightsSystem.updateRectNormal(this.selectedLightIndex, newNormal);
      });
    }

    // Position controls for all light types
    const posFolder = this.selectedLightFolder.addFolder({
      title: 'Position',
      expanded: false
    });

    const posX = { x: light.position.x };
    posFolder.addBinding(posX, 'x', {
      label: 'X',
      min: -20,
      max: 20,
      step: 0.1
    }).on('change', (ev) => {
      // Get current position from lights system to avoid resetting other axes
      const currentLights = this.lightsSystem.exportLights();
      const currentLight = currentLights[this.selectedLightIndex];
      const newPos = currentLight.position.clone();
      newPos.x = ev.value;
      this.lightsSystem.updateLightPosition(this.selectedLightIndex, newPos);
    });

    const posY = { y: light.position.y };
    posFolder.addBinding(posY, 'y', {
      label: 'Y',
      min: -20,
      max: 20,
      step: 0.1
    }).on('change', (ev) => {
      // Get current position from lights system to avoid resetting other axes
      const currentLights = this.lightsSystem.exportLights();
      const currentLight = currentLights[this.selectedLightIndex];
      const newPos = currentLight.position.clone();
      newPos.y = ev.value;
      this.lightsSystem.updateLightPosition(this.selectedLightIndex, newPos);
    });

    const posZ = { z: light.position.z };
    posFolder.addBinding(posZ, 'z', {
      label: 'Z',
      min: -20,
      max: 20,
      step: 0.1
    }).on('change', (ev) => {
      // Get current position from lights system to avoid resetting other axes
      const currentLights = this.lightsSystem.exportLights();
      const currentLight = currentLights[this.selectedLightIndex];
      const newPos = currentLight.position.clone();
      newPos.z = ev.value;
      this.lightsSystem.updateLightPosition(this.selectedLightIndex, newPos);
    });

    // Spot light direction controls
    if (light.type === 'spot') {
      const dirFolder = this.selectedLightFolder.addFolder({
        title: 'Direction',
        expanded: false
      });

      const dirX = { x: light.direction.x };
      dirFolder.addBinding(dirX, 'x', {
        label: 'X',
        min: -1,
        max: 1,
        step: 0.1
      }).on('change', (ev) => {
        const currentLights = this.lightsSystem.exportLights();
        const currentLight = currentLights[this.selectedLightIndex];
        const newDir = currentLight.direction.clone();
        newDir.x = ev.value;
        newDir.normalize();
        this.lightsSystem.updateSpotDirection(this.selectedLightIndex, newDir);
      });

      const dirY = { y: light.direction.y };
      dirFolder.addBinding(dirY, 'y', {
        label: 'Y',
        min: -1,
        max: 1,
        step: 0.1
      }).on('change', (ev) => {
        const currentLights = this.lightsSystem.exportLights();
        const currentLight = currentLights[this.selectedLightIndex];
        const newDir = currentLight.direction.clone();
        newDir.y = ev.value;
        newDir.normalize();
        this.lightsSystem.updateSpotDirection(this.selectedLightIndex, newDir);
      });

      const dirZ = { z: light.direction.z };
      dirFolder.addBinding(dirZ, 'z', {
        label: 'Z',
        min: -1,
        max: 1,
        step: 0.1
      }).on('change', (ev) => {
        const currentLights = this.lightsSystem.exportLights();
        const currentLight = currentLights[this.selectedLightIndex];
        const newDir = currentLight.direction.clone();
        newDir.z = ev.value;
        newDir.normalize();
        this.lightsSystem.updateSpotDirection(this.selectedLightIndex, newDir);
      });
    }
  }

  addAnimationControls() {
    if (!this.selectedLightFolder || !this.selectedLightData) return;

    const light = this.selectedLightData;
    const anim = light.animation || {};

    const animFolder = this.selectedLightFolder.addFolder({
      title: 'Animations',
      expanded: true
    });

    // Animation toggles based on type
    const toggles = {};

    if (light.type === 'point') {
      toggles.circular = !!anim.circular;
      toggles.wave = !!anim.wave;
    }

    if (light.type === 'point' || light.type === 'spot' || light.type === 'rect') {
      toggles.linear = !!anim.linear;
    }

    toggles.flicker = !!anim.flicker;
    toggles.pulse = !!anim.pulse;

    if (light.type === 'spot' || light.type === 'rect') {
      toggles.rotation = !!anim.rotation;
    }

    Object.keys(toggles).forEach(animType => {
      animFolder.addBinding(toggles, animType, {
        label: animType.charAt(0).toUpperCase() + animType.slice(1)
      }).on('change', (ev) => {
        this.toggleAnimation(animType, ev.value);
      });
    });
  }

  toggleAnimation(animType, enabled) {
    if (this.selectedLightIndex === null) return;

    const lights = this.lightsSystem.exportLights();
    const light = lights[this.selectedLightIndex];
    if (!light) return;

    let newAnim = { ...(light.animation || {}) };

    if (enabled) {
      switch(animType) {
        case 'circular':
          newAnim.circular = { speed: 1, radius: 2 };
          break;
        case 'linear':
          newAnim.linear = {
            to: new Vector3(light.position.x + 5, light.position.y, light.position.z),
            duration: 2,
            mode: 'pingpong'
          };
          break;
        case 'wave':
          newAnim.wave = { axis: [0, 1, 0], speed: 1, amplitude: 1 };
          break;
        case 'flicker':
          newAnim.flicker = { speed: 10, intensity: 0.3 };
          break;
        case 'pulse':
          newAnim.pulse = { speed: 1, amount: 0.3, target: PulseTarget.INTENSITY };
          break;
        case 'rotation':
          newAnim.rotation = { axis: [0, 1, 0], speed: 1, mode: 'continuous' };
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
    this.updateSelectedLightControls();
  }

  update(time) {
    // Animate objects
    this.animatedObjects.forEach(({ mesh, rotSpeed }) => {
      if (rotSpeed.x) mesh.rotation.x = time * rotSpeed.x;
      if (rotSpeed.y) mesh.rotation.y = time * rotSpeed.y;
    });
    
    // Update stats
    this.updateStats();
  }
  
  updateStats() {
    this.stats.pointLights = this.lightsSystem.pointLightCount || 0;
    this.stats.spotLights = this.lightsSystem.spotLightCount || 0;
    this.stats.rectLights = this.lightsSystem.rectLightCount || 0;
    this.stats.totalLights = this.stats.pointLights + this.stats.spotLights + this.stats.rectLights;
  }

  createUI(pane) {
    const folder = pane.addFolder({ title: 'Light Types', expanded: true });
    this.mainFolder = folder;

    // Add light controls
    folder.addBlade({
      view: 'list',
      label: 'Add Light',
      options: [
        { text: 'Point', value: 'point' },
        { text: 'Spot', value: 'spot' },
        { text: 'Rect', value: 'rect' }
      ],
      value: this.params.addLightType
    }).on('change', (ev) => {
      this.params.addLightType = ev.value;
    });

    folder.addButton({ title: 'Add Light' }).on('click', () => {
      this.addLight(this.params.addLightType);
    });

    folder.addButton({ title: 'Load Animated Preset' }).on('click', () => {
      this.loadAnimatedPreset();
    });

    folder.addBlade({ view: 'separator' });

    // Create lights list
    const lights = this.lightsSystem.exportLights();
    this.lightsListFolder = folder.addFolder({
      title: `Lights (${lights.length})`,
      expanded: true
    });

    this.updateLightsList();

    folder.addBlade({ view: 'separator' });

    // LOD settings
    const lodFolder = folder.addFolder({ title: 'LOD Settings', expanded: false });

    lodFolder.addBinding(this.params, 'lodBias', {
      label: 'LOD Bias',
      min: 0.1,
      max: 3.0,
      step: 0.1
    }).on('change', (ev) => {
      this.lightsSystem.setLODBias(ev.value);
    });

    folder.addBlade({ view: 'separator' });

    // Visualization controls
    const visFolder = folder.addFolder({ title: 'Visualization', expanded: false });

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

    folder.addBlade({ view: 'separator' });

    // Clear button
    folder.addButton({ title: 'Clear All Lights' }).on('click', () => {
      this.lightsSystem.clearLights();
      this.selectedLightIndex = null;
      this.selectedLightData = null;

      if (this.lightMarkers) {
        this.lightMarkers.reinit(this.scene);
      }

      if (this.selectedLightFolder && !this.selectedLightFolder.disposed) {
        this.selectedLightFolder.dispose();
        this.selectedLightFolder = null;
      }

      this.updateLightsList();
    });

    // Stats
    const stats = folder.addFolder({ title: 'Stats', expanded: false });
    const lightStats = { total: 0, point: 0, spot: 0, rect: 0, animated: 0 };

    const updateStats = () => {
      const exported = this.lightsSystem.exportLights();
      lightStats.total = exported.length;
      lightStats.point = exported.filter(l => l.type === 'point').length;
      lightStats.spot = exported.filter(l => l.type === 'spot').length;
      lightStats.rect = exported.filter(l => l.type === 'rect').length;
      lightStats.animated = exported.filter(l => l.animation).length;
    };

    const totalBinding = stats.addBinding(lightStats, 'total', { label: 'Total', readonly: true });
    const pointBinding = stats.addBinding(lightStats, 'point', { label: 'Point', readonly: true });
    const spotBinding = stats.addBinding(lightStats, 'spot', { label: 'Spot', readonly: true });
    const rectBinding = stats.addBinding(lightStats, 'rect', { label: 'Rect', readonly: true });
    const animBinding = stats.addBinding(lightStats, 'animated', { label: 'Animated', readonly: true });

    this.statsIntervalId = setInterval(() => {
      if (this.active) {
        updateStats();
        totalBinding.refresh();
        pointBinding.refresh();
        spotBinding.refresh();
        rectBinding.refresh();
        animBinding.refresh();
      }
    }, 1000);
  }

  dispose() {
    // Clear stats interval
    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }

    super.dispose();
  }
}
