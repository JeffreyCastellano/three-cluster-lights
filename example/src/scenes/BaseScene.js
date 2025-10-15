// BaseScene.js - Base class for all scenes
import { Scene, PerspectiveCamera, Vector3, AmbientLight, Clock } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LightMarkers } from '../../lib/index.js';

export class BaseScene {
  constructor(renderer, lightsSystem, options = {}) {
    this.renderer = renderer;
    this.lightsSystem = lightsSystem;
    this.options = options;
    this.shadeQuery = null;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.scene = new Scene();

    // Track objects so newly added materials get patched automatically
    this._trackedObjects = new Set();
    this._handleChildAdded = this._handleChildAdded.bind(this);
    this._handleChildRemoved = this._handleChildRemoved.bind(this);
    this._registerSceneGraph(this.scene);

    // Create camera
    this.camera = new PerspectiveCamera(
      options.fov || 45,
      window.innerWidth / window.innerHeight,
      options.near || 0.1,
      options.far || 200
    );
    this.camera.position.copy(options.cameraPosition || new Vector3(20, 15, 20));

    // Create controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(options.controlsTarget || new Vector3(0, 3, 0));
    this.controls.maxDistance = options.maxDistance || 50;
    this.controls.minDistance = options.minDistance || 5;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.update();

    // Clock for animations
    this.clock = new Clock();

    // Camera position logger (enable with window.logCamera = true in console)
    this._cameraLogTimer = 0;
    this._cameraLogInterval = 3000; // Log every 3 seconds

    // Add ambient light
    const ambientLight = new AmbientLight(0xffffff, 0.02);
    this.scene.add(ambientLight);

    // Light source visualization
    this.lightMarkers = new LightMarkers(lightsSystem, {
      showGlow: options.showGlow !== undefined ? options.showGlow : true,
      pointGlowRadius: options.pointGlowRadius || 1.0,
      spotGlowRadius: options.spotGlowRadius || 1.0,
      rectGlowRadius: options.rectGlowRadius || 1.0,
      markerScale: options.markerScale !== undefined ? options.markerScale : undefined
    });
    this.showLightMarkers = options.showLightMarkers !== undefined ? options.showLightMarkers : true;

    // Track if scene is active
    this.active = false;

    // OPTIMIZATION: Track if scene needs material patching
    this._sceneDirty = true; // Start dirty to patch initial materials
  }

  // Override in subclasses - setup scene objects only
  init() {
    // Setup initial scene objects (but not lights)
  }

  // Override in subclasses - setup lights
  initLights() {
    // Setup lights for this scene

    // Defer light source visualization to avoid blocking during scene switch
    if (this.showLightMarkers) {
      requestAnimationFrame(() => {
        // Only initialize if scene is still active (not switched away)
        if (this.active && this.lightMarkers) {
          this.lightMarkers.init(this.scene);
        }
      });
    }
  }

  // Override in subclasses - hook before lights update runs
  preUpdate(time) {
    // Prepare dynamic data before clustered lighting updates
  }

  // Override in subclasses
  update(time) {
    // Update scene-specific logic
  }

  // Override in subclasses to provide scene info
  getSceneInfo() {
    return null; // Return string with scene description
  }

  // Override in subclasses to provide stats bindings
  getStatsBindings() {
    return null; // Return array of { object, property, label, format }
  }

  // Override in subclasses
  createUI(pane) {
    // Create Tweakpane UI
  }

  // Override in subclasses
  dispose() {
    // Cleanup controls
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    // Cleanup light source visualization
    if (this.lightMarkers) {
      this.lightMarkers.dispose(this.scene);
      this.lightMarkers = null;
    }

    // Cleanup scene objects
    this.scene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(mat => {
          if (mat.map) mat.map.dispose();
          if (mat.normalMap) mat.normalMap.dispose();
          if (mat.roughnessMap) mat.roughnessMap.dispose();
          if (mat.metalnessMap) mat.metalnessMap.dispose();
          if (mat.emissiveMap) mat.emissiveMap.dispose();
          if (mat.aoMap) mat.aoMap.dispose();
          mat.dispose();
        });
      }
    });

    // Clear scene - only if it has children to avoid warnings
    if (this.scene && this.scene.children.length > 0) {
      this.scene.clear();
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  activate() {
    this.active = true;

    // OPTIMIZATION: Mark scene dirty to patch materials on first render
    this._sceneDirty = true;

    // Reset camera to default position for this scene
    this.resetCamera();

    // Update ClusterLightingSystem frustum parameters to match this scene's camera
    const near = this.options.near || 0.1;
    const far = this.options.far || 200;
    this.lightsSystem.near = near;
    this.lightsSystem.far = far;

    // Recreate light markers (they were disposed on deactivate)
    if (!this.lightMarkers) {
      this.lightMarkers = new LightMarkers(this.lightsSystem, {
        showGlow: this.options.showGlow !== undefined ? this.options.showGlow : true,
        pointGlowRadius: this.options.pointGlowRadius || 1.0,
        spotGlowRadius: this.options.spotGlowRadius || 1.0,
        rectGlowRadius: this.options.rectGlowRadius || 1.0,
        markerScale: this.options.markerScale !== undefined ? this.options.markerScale : undefined
      });
    }
  }

  deactivate() {
    this.active = false;

    // Clear light source visualization
    if (this.lightMarkers) {
      this.lightMarkers.dispose(this.scene);
      this.lightMarkers = null; // Set to null after disposal
    }
  }

  resetCamera() {
    // Completely reset OrbitControls by recreating them
    const defaultPosition = this.options.cameraPosition || new Vector3(20, 15, 20);
    const defaultTarget = this.options.controlsTarget || new Vector3(0, 3, 0);

    // Dispose old controls if they exist
    if (this.controls) {
      this.controls.dispose();
    }

    // Reset camera position and frustum
    this.camera.position.copy(defaultPosition);
    this.camera.near = this.options.near || 0.1;
    this.camera.far = this.options.far || 200;
    this.camera.updateProjectionMatrix();

    // Create fresh controls with no internal state
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(defaultTarget);
    this.controls.maxDistance = this.options.maxDistance || 50;
    this.controls.minDistance = this.options.minDistance || 5;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.update();
  }

  render() {
    if (!this.active) return;

    const time = this.clock.getElapsedTime();

    // Update controls (null check for safety during transitions)
    if (this.controls) {
      this.controls.update();
    }

    // Camera position logger (enable with: window.logCamera = true)
    if (window.logCamera && this.camera && this.controls) {
      const now = performance.now();
      if (now - this._cameraLogTimer > this._cameraLogInterval) {
        this._cameraLogTimer = now;
        const pos = this.camera.position;
        const target = this.controls.target;
        console.log(
          `Camera Settings:\n` +
          `  cameraPosition: new Vector3(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}),\n` +
          `  controlsTarget: new Vector3(${target.x.toFixed(2)}, ${target.y.toFixed(2)}, ${target.z.toFixed(2)}),`
        );
      }
    }

    // Allow subclasses to update dynamic state before WASM lighting update
    this.preUpdate(time);

    // Update lights (pass scene for shadow rendering)
    this.lightsSystem.update(time, this.camera, this.scene);

    // Update light source visualization (null check for safety)
    if (this.showLightMarkers && this.lightMarkers) {
      this.lightMarkers.update(this.scene);
    }

    // OPTIMIZATION: Only patch materials if scene has changed
    // Traversing the scene every frame is expensive with many objects
    if (this._sceneDirty) {
      this.scene.traverse((object) => {
        if (object.material && !object.material.__clusteredLightingPatched) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => {
            this.lightsSystem.patchMaterial(material);
            material.__clusteredLightingPatched = true;
          });
        }
      });
      this._sceneDirty = false;
    }

    // Call subclass update
    this.update(time);

    // Start GPU timing for shade pass
    if (this.shadeQuery) this.shadeQuery.start();

    // Render
    this.renderer.render(this.scene, this.camera);

    // End GPU timing for shade pass
    if (this.shadeQuery) this.shadeQuery.end(time);
  }

  _registerSceneGraph(object) {
    if (!object || !object.addEventListener || this._trackedObjects.has(object)) {
      return;
    }

    object.addEventListener('childadded', this._handleChildAdded);
    object.addEventListener('childremoved', this._handleChildRemoved);
    this._trackedObjects.add(object);

    if (object.children && object.children.length > 0) {
      object.children.forEach(child => this._registerSceneGraph(child));
    }
  }

  _unregisterSceneGraph(object) {
    if (!object || !object.removeEventListener || object === this.scene || !this._trackedObjects.has(object)) {
      if (object && object.children && object.children.length > 0) {
        object.children.forEach(child => this._unregisterSceneGraph(child));
      }
      return;
    }

    object.removeEventListener('childadded', this._handleChildAdded);
    object.removeEventListener('childremoved', this._handleChildRemoved);
    this._trackedObjects.delete(object);

    if (object.children && object.children.length > 0) {
      object.children.forEach(child => this._unregisterSceneGraph(child));
    }
  }

  _handleChildAdded(event) {
    if (event && event.child) {
      this._registerSceneGraph(event.child);
    }

    // Mark scene dirty so BaseScene will patch materials in the next frame
    this._sceneDirty = true;
  }

  _handleChildRemoved(event) {
    if (event && event.child) {
      this._unregisterSceneGraph(event.child);
    }
  }
}
