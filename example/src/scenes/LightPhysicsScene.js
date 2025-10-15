// LightPhysicsScene.js - Physics-driven point light rain around a 3D model
import {
  Box3,
  Color,
  AmbientLight,
  MathUtils,
  PMREMGenerator,
  Vector3,
  DoubleSide
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { BaseScene } from './BaseScene.js';

const DRACO_DECODER_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';
const BASIS_TRANSCODER_URL = 'https://unpkg.com/three@0.180.0/examples/jsm/libs/basis/';
const DRAGON_MODEL_URL = '/assets/models/DragonAttenuation.glb';

const POINT_LIGHT_COUNT = 450;
const LIGHT_COLLIDER_RADIUS = 0.5; // Physics sphere radius for Rapier bodies
const DEFAULT_LIGHT_INTENSITY = 10;
const LIGHT_DECAY = 2;
const DEFAULT_LIGHT_RADIUS = 2;
const DEFAULT_POINT_GLOW_RADIUS = 0.8;
const MAX_PHYSICS_SUBSTEPS = 2;
const MOTION_UPDATE_EPSILON = 0.003;
const DEFAULT_MARKER_SCALE = 0.02; // Initial visual scale for light source markers

export class LightPhysicsScene extends BaseScene {
  constructor(renderer, lightsSystem) {
    super(renderer, lightsSystem, {
      cameraPosition: new Vector3(-3, 2, 6),
      controlsTarget: new Vector3(0, 0.5, 0),
      maxDistance: 20,
      minDistance: 1.5,
      showLightMarkers: true,
      showGlow: true,
      pointGlowRadius: DEFAULT_POINT_GLOW_RADIUS,
      useEnvironment: false,
      markerScale: DEFAULT_MARKER_SCALE
    });

    this.scene.background = new Color(0x000000);
    // Ensure only clustered lights are used: remove any native Three.js lights
    this._removeNativeThreeLights(this.scene);

    // Add a subtle ambient light for baseline visibility
    this.ambientLight = new AmbientLight(0xffffff, 0.3);
    this.scene.add(this.ambientLight);

    this.pmremGenerator = new PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.roomEnvironment = new RoomEnvironment();
    this.environmentTarget = null;

    this.loader = new GLTFLoader();
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath(DRACO_DECODER_URL);
    this.dracoLoader.preload();
    this.loader.setDRACOLoader(this.dracoLoader);

    this.ktx2Loader = new KTX2Loader();
    this.ktx2Loader.setTranscoderPath(BASIS_TRANSCODER_URL);
    this.ktx2Loader.detectSupport(this.renderer);
    this.loader.setKTX2Loader(this.ktx2Loader);

    this.mixer = null;
    this.model = null;

    this.mainFolder = null;
    this.lightStatsBlade = null;

    this.lightsMetadata = [];
    
    // Stats for display
    this.stats = {
      lightCount: 0
    };
    this.lightBodiesReady = false;

    this.physicsReady = false;
    this.physicsWorld = null;
    this.rapier = null;
    this.physicsInitPromise = null;
    this.groundColliderHandle = null;
    this.dragonColliderHandles = [];
    this.pendingLightSetup = false;
    this.pendingDragonCollider = false;

    this.lightParams = {
      intensity: DEFAULT_LIGHT_INTENSITY,
      radius: DEFAULT_LIGHT_RADIUS,
      glowRadius: DEFAULT_POINT_GLOW_RADIUS
    };

    // Visualization params
    this.markerParams = {
      markerScale: DEFAULT_MARKER_SCALE
    };

    // Light color controls
    this.colorOptions = {
      randomColors: false,
      color: '#ffffff'
    };
    this._fixedColorBinding = null;

    this._applyGlowRadius(this.lightParams.glowRadius);

    this.fixedStep = 1 / 90;
    this.maxPhysicsSubsteps = MAX_PHYSICS_SUBSTEPS;
    this.physicsAccumulator = 0;
    this.lastPhysicsTime = null;
    this._lastUpdateTime = undefined;
  }

  getSceneInfo() {
    return {
      title: 'Light Physics',
      content: `
        <p>Interactive physics-based lighting demo. Click to spawn lights that fall and bounce around the scene.</p>
        
        <h3>Features</h3>
        <ul>
          <li>Example physics (Rapier) for light interactions</li>
          <li>Lights bounce off objects and ground</li>
          <li>Customize light properties (color, radius, intensity)</li>
          <li>3D model with transmission + refraction with physics colliders</li>
        </ul>
        
        <h3>Controls</h3>
        <ul>
          <li>Click to spawn lights</li>
          <li>"Explode" button to reset all lights</li>
          <li>Adjust glow and marker scale for visualization</li>
        </ul>
      `
    };
  }

  getStatsBindings() {
    return [
      { object: this.stats, property: 'lightCount', label: '💡 Active Lights' }
    ];
  }

  init() {
    this._ensureEnvironment();
    this._initPhysics();
    this._loadModel();
    
  }

  async _initPhysics() {
    if (this.physicsInitPromise) return this.physicsInitPromise;

    this.physicsInitPromise = import('@dimforge/rapier3d-compat')
      .then(async (module) => {
        const RAPIER = module.default ?? module;
        if (!RAPIER.init) {
          throw new Error('Rapier module missing init()');
        }
        await RAPIER.init();
        this.rapier = RAPIER;
        this.physicsWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        this.physicsWorld.integrationParameters.dt = this.fixedStep;
        this.physicsWorld.integrationParameters.maxVelocityIterations = 4;
        this.physicsWorld.integrationParameters.maxStabilizationIterations = 1;
        this.physicsWorld.integrationParameters.allowedLinearError = 0.0025;
        this.physicsWorld.integrationParameters.allowedAngularError = 0.001;
        this.physicsWorld.integrationParameters.erp = 0.8;
        this.physicsReady = true;

        this._createGroundCollider();
        if (this.pendingDragonCollider) {
          this.pendingDragonCollider = false;
          this._createDragonCollider();
        }
        if (this.pendingLightSetup) {
          this.pendingLightSetup = false;
          this._setupLightBodies();
        }
      })
      .catch((err) => {
        console.error('[DragonPointerScene] Failed to initialise Rapier:', err);
      });

    return this.physicsInitPromise;
  }

  initLights() {
    this.lightsSystem.setLODBias(1.0);

    this._spawnPointLights();
    this._setupLightBodies();

    if (this.showLightMarkers) {
      requestAnimationFrame(() => {
        if (this.active && this.lightMarkers) {
          this.lightMarkers.init(this.scene);
        }
      });
    }
  }

  update(time) {
    if (!this.mixer) return;
    this.mixer.update(this._computeDelta(time));
  }

  preUpdate(time) {
    if (!this.physicsReady || !this.lightsMetadata.length) return;

    if (this.lastPhysicsTime === null) {
      this.lastPhysicsTime = time;
      return;
    }

    const delta = time - this.lastPhysicsTime;
    this.lastPhysicsTime = time;
    this.physicsAccumulator += delta;
    const maxAccumulator = this.fixedStep * this.maxPhysicsSubsteps;
    if (this.physicsAccumulator > maxAccumulator) {
      this.physicsAccumulator = maxAccumulator;
    }

    let steps = 0;
    while (this.physicsAccumulator >= this.fixedStep && steps < this.maxPhysicsSubsteps) {
      this.physicsWorld.step();
      this.physicsAccumulator -= this.fixedStep;
      steps++;
    }

    for (let i = 0; i < this.lightsMetadata.length; i++) {
      const meta = this.lightsMetadata[i];
      if (meta.bodyHandle === undefined) continue;

      const body = this.physicsWorld.getRigidBody(meta.bodyHandle);
      if (!body) continue;
      // Don't skip updates for sleeping bodies to avoid flicker when CCD pauses

      const t = body.translation();
      meta.position.set(t.x, t.y, t.z);
      const lastSent = meta.lastSentPosition;
      const dx = Math.abs(t.x - lastSent.x);
      const dy = Math.abs(t.y - lastSent.y);
      const dz = Math.abs(t.z - lastSent.z);
      if (dx > MOTION_UPDATE_EPSILON || dy > MOTION_UPDATE_EPSILON || dz > MOTION_UPDATE_EPSILON) {
        lastSent.set(t.x, t.y, t.z);
        this.lightsSystem.updateLightPosition(meta.index, lastSent);
      }

      // Respawn lights that fall out of bounds
      if (t.y < -6) {
        this._respawnLight(meta, body);
      }
    }
  }

  activate() {
    super.activate();
    this.lastPhysicsTime = null;
    this._lastUpdateTime = undefined;
  }

  createUI(pane) {
    this.mainFolder = pane.addFolder({
      title: 'Physics Lights',
      expanded: true
    });

    this.mainFolder.addButton({ title: 'Explode' }).on('click', () => {
      this._resetLightBodies();
    });

    const lightControls = this.mainFolder.addFolder({
      title: 'Point Light Settings',
      expanded: true
    });

    lightControls.addBinding(this.lightParams, 'radius', {
      min: 0.5,
      max: 5,
      step: 0.1,
      label: 'Radius'
    }).on('change', (ev) => {
      this.lightParams.radius = ev.value;
      this._applyLightRadius(ev.value);
    });

    lightControls.addBinding(this.lightParams, 'intensity', {
      min: 0.5,
      max: 12,
      step: 0.1,
      label: 'Intensity'
    }).on('change', (ev) => {
      this.lightParams.intensity = ev.value;
      this._applyLightIntensity(ev.value);
    });

    lightControls.addBinding(this.lightParams, 'glowRadius', {
      min: 0.1,
      max: 2,
      step: 0.05,
      label: 'Glow Size'
    }).on('change', (ev) => {
      this._applyGlowRadius(ev.value);
    });

    // Marker visualization scale (only affects source marker size)
    lightControls.addBinding(this.markerParams, 'markerScale', {
      min: 0.02,
      max: 0.5,
      step: 0.01,
      label: 'Marker Scale'
    }).on('change', (ev) => {
      if (this.lightMarkers) {
        this.lightMarkers.setMarkerScale(ev.value);
      }
    });

    // Color controls
    lightControls.addBinding(this.colorOptions, 'randomColors', {
      label: 'Random Colors'
    }).on('change', (ev) => {
      this.colorOptions.randomColors = ev.value;
      if (this._fixedColorBinding) {
        this._fixedColorBinding.disabled = this.colorOptions.randomColors;
      }
      if (this.colorOptions.randomColors) {
        this._randomizeLightColors();
      } else {
        this._applyFixedColorToAllLights(new Color(this.colorOptions.color));
      }
    });

    this._fixedColorBinding = lightControls.addBinding(this.colorOptions, 'color', {
      label: 'Color'
    }).on('change', (ev) => {
      if (!this.colorOptions.randomColors) {
        this._applyFixedColorToAllLights(new Color(ev.value));
      }
    });

    if (this._fixedColorBinding) {
      this._fixedColorBinding.disabled = this.colorOptions.randomColors;
    }
  }

  deactivate() {
    super.deactivate();
    this.lastPhysicsTime = null;
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.model);
      this.mixer = null;
    }

    if (this.environmentTarget) {
      this.environmentTarget.dispose();
      this.environmentTarget = null;
      this.scene.environment = null;
    }

    if (this.ktx2Loader) {
      this.ktx2Loader.dispose();
      this.ktx2Loader = null;
    }

    if (this.pmremGenerator) {
      this.pmremGenerator.dispose();
      this.pmremGenerator = null;
    }

    if (this.dracoLoader) {
      this.dracoLoader.dispose();
      this.dracoLoader = null;
    }

    this._teardownPhysics();

    super.dispose();
  }

  _spawnPointLights() {
    this._removeExistingLightBodies();

    const lights = [];
    this.lightsMetadata = [];

    for (let i = 0; i < POINT_LIGHT_COUNT; i++) {
      const position = new Vector3(
        MathUtils.randFloatSpread(2.8),
        3.5 + Math.random() * 2.0,
        MathUtils.randFloatSpread(2.8)
      );

      const lightColor = this.colorOptions && this.colorOptions.randomColors
        ? new Color(Math.random(), Math.random(), Math.random())
        : new Color(this.colorOptions && this.colorOptions.color ? this.colorOptions.color : '#ffffff');

      lights.push({
        type: 'point',
        position,
        color: lightColor,
        intensity: this.lightParams.intensity,
        radius: this.lightParams.radius,
        decay: LIGHT_DECAY
      });
    }

    this.lightsSystem.bulkConfigPointLights(lights, false);

    this.lightsMetadata = lights.map((light, index) => ({
      index,
      position: light.position.clone(),
      lastSentPosition: light.position.clone(),
      color: light.color.clone(),
      bodyHandle: undefined
    }));

    // Update stats
    this.stats.lightCount = this.lightsMetadata.length;
    
    if (this.lightStatsBlade) {
      this.lightStatsBlade.value = `${this.lightsMetadata.length} lights`;
    }
  }

  _removeExistingLightBodies() {
    if (!this.physicsReady || !this.physicsWorld) {
      return;
    }

    for (let i = 0; i < this.lightsMetadata.length; i++) {
      const meta = this.lightsMetadata[i];
      if (meta.bodyHandle === undefined) continue;
      const body = this.physicsWorld.getRigidBody(meta.bodyHandle);
      if (body) {
        this.physicsWorld.removeRigidBody(body);
      }
      meta.bodyHandle = undefined;
    }
  }

  _setupLightBodies() {
    if (!this.physicsReady || !this.physicsWorld || !this.rapier) {
      this.pendingLightSetup = true;
      return;
    }

    // Remove existing bodies
    this.lightsMetadata.forEach((meta) => {
      if (meta.bodyHandle !== undefined) {
        const body = this.physicsWorld.getRigidBody(meta.bodyHandle);
        if (body) {
          this.physicsWorld.removeRigidBody(body);
        }
      }
      meta.bodyHandle = undefined;
    });

    const { RigidBodyDesc, ColliderDesc } = this.rapier;

    for (let i = 0; i < this.lightsMetadata.length; i++) {
      const meta = this.lightsMetadata[i];
      const bodyDesc = RigidBodyDesc.dynamic()
        .setTranslation(meta.position.x, meta.position.y, meta.position.z)
        .setLinearDamping(0.2)
        .setAngularDamping(0.6)
        .setCcdEnabled(true)
        .setCanSleep(false);
      const body = this.physicsWorld.createRigidBody(bodyDesc);

      const colliderDesc = ColliderDesc.ball(LIGHT_COLLIDER_RADIUS)
        .setRestitution(0.5)
        .setFriction(0.6)
        .setDensity(0.3);
      this.physicsWorld.createCollider(colliderDesc, body);

      body.setLinvel(
        {
          x: MathUtils.randFloatSpread(1.5),
          y: Math.random() * 0.5,
          z: MathUtils.randFloatSpread(1.5)
        },
        false
      );

      meta.bodyHandle = body.handle;
    }
  }

  _resetLightBodies() {
    if (!this.physicsReady || !this.physicsWorld) return;

    for (let i = 0; i < this.lightsMetadata.length; i++) {
      const meta = this.lightsMetadata[i];
      if (meta.bodyHandle === undefined) continue;
      const body = this.physicsWorld.getRigidBody(meta.bodyHandle);
      if (!body) continue;

      const spawnPos = {
        x: MathUtils.randFloatSpread(2.5),
        y: 4.5 + Math.random() * 2.5,
        z: MathUtils.randFloatSpread(2.5)
      };

      body.setTranslation(spawnPos, false);
      if (body.wakeUp) {
        body.wakeUp();
      }
      meta.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
      meta.lastSentPosition.set(spawnPos.x, spawnPos.y, spawnPos.z);
      this.lightsSystem.updateLightPosition(meta.index, meta.lastSentPosition);
      body.setLinvel(
        {
          x: MathUtils.randFloatSpread(1.2),
          y: -Math.random(),
          z: MathUtils.randFloatSpread(1.2)
        },
        false
      );
      body.setAngvel(
        {
          x: MathUtils.randFloatSpread(2.0),
          y: MathUtils.randFloatSpread(2.0),
          z: MathUtils.randFloatSpread(2.0)
        },
        false
      );
    }

    if (this.lightMarkers) {
      this.lightMarkers.reinit(this.scene);
    }
  }

  _respawnLight(meta, body) {
    const spawnPos = {
      x: MathUtils.randFloatSpread(2.0),
      y: 4.0 + Math.random() * 3.0,
      z: MathUtils.randFloatSpread(2.0)
    };

    body.setTranslation(spawnPos, false);
    if (body.wakeUp) {
      body.wakeUp();
    }
    meta.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
    meta.lastSentPosition.set(spawnPos.x, spawnPos.y, spawnPos.z);
    this.lightsSystem.updateLightPosition(meta.index, meta.lastSentPosition);
    body.setLinvel(
      {
        x: MathUtils.randFloatSpread(0.8),
        y: -Math.random(),
        z: MathUtils.randFloatSpread(0.8)
      },
      false
    );
    body.setAngvel(
      {
        x: MathUtils.randFloatSpread(1.0),
        y: MathUtils.randFloatSpread(1.0),
        z: MathUtils.randFloatSpread(1.0)
      },
      false
    );
  }

  _randomizeLightColors(initial = false) {
    if (!this.lightsMetadata.length) return;

    for (let i = 0; i < this.lightsMetadata.length; i++) {
      const meta = this.lightsMetadata[i];
      meta.color.setHSL(Math.random(), 0.5 + Math.random() * 0.4, 0.4 + Math.random() * 0.3);
      this.lightsSystem.updateLightColor(meta.index, meta.color);
    }

    if (!initial && this.lightMarkers) {
      this.lightMarkers.reinit(this.scene);
    }
  }

  _applyFixedColorToAllLights(color) {
    if (!this.lightsMetadata.length) return;
    const target = color instanceof Color ? color : new Color(color);
    for (let i = 0; i < this.lightsMetadata.length; i++) {
      const meta = this.lightsMetadata[i];
      meta.color.copy(target);
      this.lightsSystem.updateLightColor(meta.index, meta.color);
    }
    if (this.lightMarkers) {
      this.lightMarkers.reinit(this.scene);
    }
  }

  _applyLightRadius(radius) {
    if (!this.lightsMetadata.length) return;

    for (let i = 0; i < this.lightsMetadata.length; i++) {
      const meta = this.lightsMetadata[i];
      this.lightsSystem.updateLightRadius(meta.index, radius);
    }
  }

  _applyLightIntensity(intensity) {
    if (!this.lightsMetadata.length) return;

    for (let i = 0; i < this.lightsMetadata.length; i++) {
      const meta = this.lightsMetadata[i];
      this.lightsSystem.updateLightIntensity(meta.index, intensity);
    }
  }

  _applyGlowRadius(glowRadius) {
    this.lightParams.glowRadius = glowRadius;
    this.options.pointGlowRadius = glowRadius;

    if (this.lightMarkers) {
      this.lightMarkers.setGlowRadius(glowRadius);
    }
  }

  _createGroundCollider() {
    if (!this.physicsReady || !this.rapier || !this.physicsWorld) return;
    if (this.groundColliderHandle !== null) return;

    // Use a thin but solid ground slab slightly below y=0 to prevent tunneling
    const groundDesc = this.rapier.ColliderDesc.cuboid(25, -0.5, 25)
      .setTranslation(0, -0.5, 0)
      .setRestitution(0.2)
      .setFriction(0.9);

    const collider = this.physicsWorld.createCollider(groundDesc);
    this.groundColliderHandle = collider.handle;
  }

  _clearDragonColliders() {
    if (!this.physicsWorld || !this.dragonColliderHandles.length) {
      return;
    }

    for (let i = 0; i < this.dragonColliderHandles.length; i++) {
      const handle = this.dragonColliderHandles[i];
      if (handle === undefined || handle === null) continue;
      const collider = this.physicsWorld.getCollider(handle);
      if (collider) {
        this.physicsWorld.removeCollider(collider, true);
      }
    }

    this.dragonColliderHandles = [];
  }

  _createDragonCollider() {
    if (!this.model) {
      this.pendingDragonCollider = true;
      return;
    }
    if (!this.physicsReady || !this.physicsWorld || !this.rapier) {
      this.pendingDragonCollider = true;
      return;
    }

    if (this.dragonColliderHandles.length) {
      this._clearDragonColliders();
    }

    const bounds = new Box3().setFromObject(this.model);
    if (!isFinite(bounds.min.x) || bounds.isEmpty()) {
      console.warn('[DragonPointerScene] Unable to build dragon collider (invalid bounds)');
      return;
    }

    const size = new Vector3();
    const center = new Vector3();
    bounds.getSize(size);
    bounds.getCenter(center);

    const axisCandidates = [
      { key: 'x', size: size.x, dir: new Vector3(1, 0, 0) },
      { key: 'z', size: size.z, dir: new Vector3(0, 0, 1) },
      { key: 'y', size: size.y, dir: new Vector3(0, 1, 0) }
    ];
    let dominantAxis = axisCandidates[0];
    for (let i = 1; i < axisCandidates.length; i++) {
      if (axisCandidates[i].size > dominantAxis.size) {
        dominantAxis = axisCandidates[i];
      }
    }

    if (dominantAxis.size === 0) {
      console.warn('[DragonPointerScene] Unable to build dragon collider (degenerate size)');
      return;
    }

    const segments = [
      {
        offset: 0,
        halfExtents: { x: size.x * 0.18, y: size.y * 0.2, z: size.z * 0.22 },
        heightFactor: 0.35
      },
      {
        offset: 0.3,
        halfExtents: { x: size.x * 0.14, y: size.y * 0.18, z: size.z * 0.18 },
        heightFactor: 0.4
      },
      {
        offset: -0.35,
        halfExtents: { x: size.x * 0.16, y: size.y * 0.16, z: size.z * 0.2 },
        heightFactor: 0.3
      }
    ];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const offsetVec = dominantAxis.dir.clone().multiplyScalar(dominantAxis.size * segment.offset);
      const segmentCenter = new Vector3(
        center.x + offsetVec.x,
        bounds.min.y + size.y * segment.heightFactor,
        center.z + offsetVec.z
      );

      const halfX = Math.max(segment.halfExtents.x * 0.5, 0.05);
      const halfY = Math.max(segment.halfExtents.y * 0.5, 0.05);
      const halfZ = Math.max(segment.halfExtents.z * 0.5, 0.05);

      const colliderDesc = this.rapier.ColliderDesc.cuboid(halfX, halfY, halfZ)
        .setTranslation(segmentCenter.x, segmentCenter.y, segmentCenter.z)
        .setRestitution(0.5)
        .setFriction(0.6);

      const collider = this.physicsWorld.createCollider(colliderDesc);
      this.dragonColliderHandles.push(collider.handle);
    }
  }

  _teardownPhysics() {
    if (!this.physicsWorld || !this.rapier) return;

    this.lightsMetadata.forEach((meta) => {
      if (meta.bodyHandle !== undefined) {
        const body = this.physicsWorld.getRigidBody(meta.bodyHandle);
        if (body) {
          this.physicsWorld.removeRigidBody(body);
        }
      }
    });

    this._clearDragonColliders();

    if (this.groundColliderHandle !== null) {
      const collider = this.physicsWorld.getCollider(this.groundColliderHandle);
      if (collider) {
        this.physicsWorld.removeCollider(collider, true);
      }
      this.groundColliderHandle = null;
    }

    this.physicsWorld.free();
    this.physicsWorld = null;
    this.rapier = null;
    this.physicsReady = false;
    this.physicsInitPromise = null;
  }

  _ensureEnvironment() {
    // Respect per-scene option to disable IBL so the scene starts dark
    if (this.options.useEnvironment === false) {
      this.scene.environment = null;
      return;
    }
    if (this.environmentTarget) {
      this.scene.environment = this.environmentTarget.texture;
      return;
    }

    this.environmentTarget = this.pmremGenerator.fromScene(this.roomEnvironment, 0.04);
    this.scene.environment = this.environmentTarget.texture;
  }

  _computeDelta(time) {
    if (this._lastUpdateTime === undefined) {
      this._lastUpdateTime = time;
      return 0;
    }
    const delta = time - this._lastUpdateTime;
    this._lastUpdateTime = time;
    return delta;
  }

  _removeNativeThreeLights(root) {
    if (!root || !root.traverse) return;
    const toRemove = [];
    root.traverse((obj) => {
      if (obj && obj.isLight) {
        toRemove.push(obj);
      }
    });
    for (let i = 0; i < toRemove.length; i++) {
      const light = toRemove[i];
      if (light.parent) {
        light.parent.remove(light);
      }
      // Dispose shadow map if present to free GPU memory
      if (light.shadow && light.shadow.map && light.shadow.map.dispose) {
        light.shadow.map.dispose();
      }
      if (typeof light.dispose === 'function') {
        light.dispose();
      }
    }
  }

  _loadModel() {
    this.loader.load(
      DRAGON_MODEL_URL,
      (gltf) => {
        this.model = gltf.scene;
        // Strip any lights embedded in the glTF before adding to the scene
        this._removeNativeThreeLights(this.model);
        // Ensure background/geometry is visible from both sides
        this.model.traverse((obj) => {
          if (obj && obj.isMesh && obj.material) {
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            materials.forEach((mat) => {
              if (mat && mat.side !== DoubleSide) {
                mat.side = DoubleSide;
                mat.needsUpdate = true;
              }
            });
          }
        });
        this.scene.add(this.model);
        this._sceneDirty = true;
        this._createDragonCollider();
      },
      undefined,
      (error) => {
        console.error('[DragonPointerScene] Failed to load dragon glTF:', error);
      }
    );
  }
}
