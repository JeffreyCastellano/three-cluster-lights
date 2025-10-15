// BasicExampleScene.js - Basic example scene with mixed animations
import { Vector3, PlaneGeometry, MeshStandardMaterial, Mesh, AmbientLight, BatchedMesh, Matrix4, Quaternion, Euler, Color, TextureLoader, RepeatWrapping, SRGBColorSpace, CanvasTexture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { BaseScene } from './BaseScene.js';
import { PulseTarget } from '../../lib/index.js';

export class BasicExampleScene extends BaseScene {
  constructor(renderer, lightsSystem) {
    super(renderer, lightsSystem, {
      cameraPosition: new Vector3(69.24, 5.30, 28.30),
      controlsTarget: new Vector3(17.23, -16.84, 28.61),
      maxDistance: 50000,
      minDistance: 1,
      far: 50000  // Allow zooming out to see large grids
    });
    this.textureLoader = new TextureLoader();
    
    this.params = {
      size: 16,
      helmetSpacing: 6, // Place helmet every N grid cells (1 = every cell, 2 = every other cell, etc)
      showHelmets: false,
      lightLODBias: 25.0,
      showLightMarkers: true,
      showGlow: true,
      glowRadius: 0.3
    };

    this.maxLightsInitialized = false;
    this.helmetModel = null;
    this.helmetInstancedMesh = null;
    this.helmetBatchedMesh = null;
    this.isLoadingLights = false; // Track progressive loading state

    // Stats for display
    this.stats = {
      gridSize: '16×16',
      totalLights: 1024
    };

    // Setup GLTF loader with Draco support
    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.loader.setDRACOLoader(dracoLoader);
  }

  getSceneInfo() {
    return {
      title: 'Basic Example',
      content: `
        <p>A classic demonstration of clustered lighting with a grid of point lights. Each light can have different animations: circular, wave, pulse, flicker, etc.</p>
        
        <h3>Features</h3>
        <ul>
          <li>Dynamic grid size to control number of lights</li>
          <li>Per-light animation controls</li>
          <li>Load models and patch materials dynamically (Helmet)</li>
          <li>WASM-powered light animations</li>
        </ul>
        
        <h3>Performance</h3>
        <ul>
          <li>16×16 = 1024 lights (recommended)</li>
          <li>32×32 = 4096 lights (mid-end GPUs)</li>
          <li>90x90 = 32000 lights (extreme stress test)</li>
        </ul>
      `
    };
  }

  getStatsBindings() {
    return [
      { object: this.stats, property: 'totalLights', label: '💡 Total Lights' }
    ];
  }

  init() {
    // Add ground plane with per-checker roughness (black = shiny, white = matte)
    const REPEAT = 200;

    const groundGeometry = new PlaneGeometry(1024, 1024);
    const groundMaterial = new MeshStandardMaterial({
      // Use high base roughness so roughnessMap fully controls shininess
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0
    });
    const ground = new Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.renderOrder = 0;
    //ground.receiveShadow = true;
    this.scene.add(ground);

    // Reduce bump (normal map) intensity on white checkers by modulating normalScale per-pixel
    groundMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.whiteNormalScale = { value: 0.0 }; // lower bump on white squares
      shader.uniforms.blackNormalScale = { value: 1.0 };  // full bump on black squares

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP
  float __nmWeight = 1.0;
  #ifdef USE_MAP
    vec3 __mapColor = texture2D( map, vUv ).rgb;
    float __lum = dot(__mapColor, vec3(0.2126, 0.7152, 0.0722));
    __nmWeight = mix( blackNormalScale, whiteNormalScale, __lum );
  #endif

  vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale * __nmWeight;
  mapN = normalize( mapN );

  #ifdef USE_TANGENT
    normal = normalize( vTBN * mapN );
  #else
    normal = perturbNormal2Arb( -vViewPosition, normal, mapN );
  #endif
#endif`
      );
    };



    this.textureLoader.load(
      '/assets/textures/FloorsCheckerboard_S_Diffuse.webp',
      (tex) => {
        tex.wrapS = RepeatWrapping;
        tex.wrapT = RepeatWrapping;
        tex.repeat.set(REPEAT, REPEAT);
        tex.colorSpace = SRGBColorSpace;

        groundMaterial.map = tex;

        // Create and assign roughness map based on luminance of diffuse map
        const rMap = this._generateRoughnessMapFromDiffuse(tex, 0.1, 0.9);
        if (rMap) {
          rMap.wrapS = RepeatWrapping;
          rMap.wrapT = RepeatWrapping;
          rMap.repeat.copy(tex.repeat);
          // Align orientation with color map
          rMap.flipY = true;
          groundMaterial.roughnessMap = rMap;
          groundMaterial.needsUpdate = true;
        }
      }
    );

    this.textureLoader.load(
      '/assets/textures/FloorsCheckerboard_S_Normal.webp',
      (tex) => {
        tex.wrapS = RepeatWrapping;
        tex.wrapT = RepeatWrapping;
        tex.repeat.set(REPEAT, REPEAT);
        groundMaterial.normalMap = tex;
      }
    );

    // Load helmet model
    this.loadHelmetModel();
  }

  _generateRoughnessMapFromDiffuse(diffuseTexture, blackRoughness = 0.1, whiteRoughness = 0.9) {
    try {
      const image = diffuseTexture.image;
      if (!image) return null;

      const width = image.width;
      const height = image.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(image, 0, 0, width, height);
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;

      const range = Math.max(0, Math.min(1, whiteRoughness)) - Math.max(0, Math.min(1, blackRoughness));
      const base = Math.max(0, Math.min(1, blackRoughness));

      for (let i = 0; i < data.length; i += 4) {
        // sRGB -> approximate luminance (values are already in 0-255 sRGB space)
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        // Map: black (0) -> blackRoughness, white (1) -> whiteRoughness
        const rough = base + range * luminance;
        const v = Math.max(0, Math.min(1, rough)) * 255;
        data[i] = v;
        data[i + 1] = v; // three.js samples G for roughnessMap, grayscale keeps channels equal
        data[i + 2] = v;
        // keep alpha as-is
      }

      ctx.putImageData(imgData, 0, 0);
      const roughnessTexture = new CanvasTexture(canvas);
      roughnessTexture.needsUpdate = true;
      return roughnessTexture;
    } catch (e) {
      console.error('[GridScene] Failed generating roughnessMap from diffuse:', e);
      return null;
    }
  }

  loadHelmetModel() {
    this.loader.load(
      '/assets/models/DamagedHelmet.glb',
      (gltf) => {
        this.helmetModel = gltf.scene;

        // Check for GPU instancing extension
        const extensions = gltf.parser.json.extensionsUsed || [];

        // Log mesh structure for debugging
        let meshCount = 0;
        let instancedCount = 0;
        this.helmetModel.traverse((child) => {
          if (child.isInstancedMesh) {
            instancedCount++;

          } else if (child.isMesh) {
            meshCount++;
            const mat = child.material;
          }
        });

        // If there are multiple meshes, consider merging them for better performance
        if (meshCount > 1) {
          console.warn(`⚠️ Model has ${meshCount} separate meshes - consider merging geometry for better performance`);
        }

        // Create instanced mesh after model is loaded
        this.createHelmetInstances(this.params.size);
      },
      (progress) => {
        console.info(`Loading: ${(progress.loaded / progress.total * 100).toFixed(2)}%`);
      },
      (error) => {
        console.error('Error loading helmet model:', error);
      }
    );
  }

  createHelmetInstances(size) {
    if (!this.helmetModel) return;


    // Remove existing instanced/batched meshes
    if (this.helmetInstancedMesh) {
      this.helmetInstancedMesh.forEach(mesh => {
        this.scene.remove(mesh);
      });
      this.helmetInstancedMesh = null;
    }

    if (this.helmetBatchedMesh) {
      this.scene.remove(this.helmetBatchedMesh);
      // Dispose geometry before disposing the batched mesh
      if (this.helmetBatchedMesh.geometry) {
        this.helmetBatchedMesh.geometry.dispose();
      }
      // Dispose material
      if (this.helmetBatchedMesh.material) {
        const materials = Array.isArray(this.helmetBatchedMesh.material) ?
          this.helmetBatchedMesh.material : [this.helmetBatchedMesh.material];
        materials.forEach(mat => mat.dispose());
      }
      this.helmetBatchedMesh.dispose();
      this.helmetBatchedMesh = null;
    }

       // Only create helmets if visible
       if (!this.params.showHelmets) {
        return;
      }

    // Always use BatchedMesh
    this.createBatchedMeshInstances(size);
  }

  createBatchedMeshInstances(size) {

    // Collect all meshes from the model
    const meshes = [];
    this.helmetModel.traverse((child) => {
      if (child.isMesh) {
        meshes.push(child);
      }
    });

    if (meshes.length === 0) {
      console.error('No meshes found in helmet model');
      return;
    }

    // Calculate actual helmet count based on spacing
    const spacing = this.params.helmetSpacing;
    const helmetCount = Math.ceil(size / spacing) * Math.ceil(size / spacing);

    // Calculate total vertex/index counts
    let totalVertices = 0;
    let totalIndices = 0;
    meshes.forEach(mesh => {
      totalVertices += mesh.geometry.attributes.position.count;
      totalIndices += mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count;
    });

    const maxGeometries = helmetCount * meshes.length;
    const maxVertices = totalVertices * helmetCount;
    const maxIndices = totalIndices * helmetCount;


    // Create BatchedMesh
    const material = this.params.simplifyMaterial ?
      new MeshPhysicalMaterial({ color: 0x888888 }) :
      meshes[0].material;

    this.helmetBatchedMesh = new BatchedMesh(maxGeometries, maxVertices, maxIndices, material);
    this.helmetBatchedMesh.castShadow = false;
    this.helmetBatchedMesh.receiveShadow = false;
    this.helmetBatchedMesh.frustumCulled = false;

    // Pre-calculate rotations for helmets we'll actually place
    const rotations = new Float32Array(helmetCount);
    for (let i = 0; i < helmetCount; i++) {
      rotations[i] = Math.random() * Math.PI * 2;
    }

    // Add all geometries to the batch
    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);

    let geometryIds = [];

    // Pre-add all unique geometries once
    meshes.forEach(mesh => {
      const geoId = this.helmetBatchedMesh.addGeometry(mesh.geometry);
      geometryIds.push(geoId);
    });

    //rotation.set(0, rotations[index], Math.PI/2);
    // Create instances with transforms - only place helmets every N cells
    const rotation = new Euler();
    let index = 0;
    let offset = 4;
    for (let i = 0; i < size; i += spacing) {
      for (let j = 0; j < size; j += spacing) {
        position.set(i * offset, 2, j * offset); // Raise helmet up a bit
        rotation.set(Math.PI / 2, 0, rotations[index]); 
        quaternion.setFromEuler(rotation);
        scale.set(2, 2, 2); // Make helmet 2x bigger
        matrix.compose(position, quaternion, scale);

        // Add instance for each geometry part
        geometryIds.forEach(geoId => {
          const instanceId = this.helmetBatchedMesh.addInstance(geoId);
          this.helmetBatchedMesh.setMatrixAt(instanceId, matrix);
        });

        index++;
      }
    }

    this.scene.add(this.helmetBatchedMesh);
  }

  updateInstanceTransforms(size) {

    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3(2, 2, 2); // Make helmet 2x bigger
    const rotation = new Euler();

    const spacing = this.params.helmetSpacing;
    const helmetCount = Math.ceil(size / spacing) * Math.ceil(size / spacing);

    // Pre-calculate all rotations for helmets we'll place
    const rotations = new Float32Array(helmetCount);
    for (let i = 0; i < helmetCount; i++) {
      rotations[i] = Math.random() * Math.PI * 2;
    }

    // Apply same transformations to all instanced meshes
    // Each mesh part needs the same transforms applied
    this.helmetInstancedMesh.forEach((instancedMesh) => {
      let index = 0;
      for (let i = 0; i < size; i += spacing) {
        for (let j = 0; j < size; j += spacing) {
          // Position in grid
          position.set(i * 4, 1, j * 4); // Raise helmet up a bit

          // Use pre-calculated rotation for consistency
          rotation.set(0, rotations[index], 0); // Just rotate around Y axis
          quaternion.setFromEuler(rotation);

          // Build transformation matrix
          matrix.compose(position, quaternion, scale);

          // Set matrix for this instance
          instancedMesh.setMatrixAt(index, matrix);
          index++;
        }
      }

      // Mark instance matrix for update
      instancedMesh.instanceMatrix.needsUpdate = true;
    });

    console.timeEnd('[GridScene] Update instance transforms');
  }

  initLights() {
    // Clear previous scene's lights (reuses pre-allocated WASM memory)
    this.lightsSystem.clearLights();

    // Generate lights
    this.generateLights(this.params.size);

    // Set LOD bias
    this.lightsSystem.setLODBias(this.params.lightLODBias);

    // Defer light source visualization to avoid blocking during scene switch
    if (this.showLightMarkers) {
      requestAnimationFrame(() => {
        if (this.active && this.lightMarkers) {
          this.lightMarkers.init(this.scene);
        }
      });
    }
  }

  generateLights(size) {
    const lights = this._generateLightsBatch(0, size, size);
    this.lightsSystem.bulkConfigPointLights(lights, false);
    
    // Update stats
    this.stats.gridSize = `${size}×${size}`;
    this.stats.totalLights = size * size * 4;
  }

  _generateLightsBatch(startRow, endRow, gridSize) {
    const lights = [];

    for (let i = startRow; i < endRow; i++) {
      for (let j = 0; j < gridSize; j++) {
        const baseX = i * 4;
        const baseZ = j * 4;

        for (let k = 0; k < 4; k++) {
          const lightColor = new Color().setHSL(Math.random(), 0.66, 0.5);
          const basePos = new Vector3(
            baseX + (Math.random() - 0.5) * 2,
            0.66 + Math.random() * 0.42 + k * 0.66,
            baseZ + (Math.random() - 0.5) * 2
          );

          let animation = null;
          const animType = Math.floor(Math.random() * 4);

          if (animType === 0 && Math.floor(k / 2) & 1) {
            animation = {
              circular: {
                speed: Math.random() * (Math.floor(k / 2) & 1 ? -1 : 1),
                radius: 1 + Math.random()
              }
            };
          } else if (animType === 1) {
            animation = {
              flicker: {
                speed: 8 + Math.random() * 4,
                intensity: 0.2 + Math.random() * 0.3,
                seed: Math.random() * 100
              }
            };
          } else if (animType === 2) {
            animation = {
              pulse: {
                speed: 0.5 + Math.random() * 2,
                amount: 0.2 + Math.random() * 0.3,
                target: Math.random() > 0.5 ? PulseTarget.INTENSITY : PulseTarget.RADIUS
              }
            };
          } else if (animType === 3 && k === 0) {
            animation = {
              wave: {
                axis: [0, 1, 0],
                speed: 1 + Math.random(),
                amplitude: 0.5 + Math.random() * 0.5,
                phase: Math.random() * Math.PI * 2
              }
            };
          }

          lights.push({
            type: 'point',
            position: basePos,
            color: lightColor,
            intensity: 1 + Math.random() * 3,
            radius: 2 + Math.random() * 4,
            decay: 2.0,
            animation
          });
        }
      }
    }

    return lights;
  }

  generateLightsProgressive(size) {
    // Generate and add lights in batches across multiple frames
    // This prevents main thread freeze on large grids (32k+ lights)
    const batchSize = 8; // Process 8 rows at a time (8 * size * 4 lights per batch)
    let currentRow = 0;

    const processBatch = () => {
      const endRow = Math.min(currentRow + batchSize, size);
      const lights = this._generateLightsBatch(currentRow, endRow, size); // Pass size to ensure consistency

      // Add this batch to the lighting system
      this.lightsSystem.bulkConfigPointLights(lights, currentRow > 0); // append=true for subsequent batches

      currentRow = endRow;

      // Schedule next batch if there are more rows to process
      if (currentRow < size) {
        requestAnimationFrame(processBatch);
      } else {
        // All batches complete - finalize textures and cluster params
        this.lightsSystem.finalizeProgressiveLoading();

        // Mark loading as complete
        this.isLoadingLights = false;

        // Reinitialize light sources (light count changed)
        if (this.lightMarkers) {
          this.lightMarkers.reinit(this.scene);
        }
      }
    };

    // Start progressive loading
    processBatch();
  }

  updateSize(newSize) {
    this.params.size = newSize;

    // Clear lights (reuses pre-allocated WASM memory)
    this.lightsSystem.clearLights();

    // Generate new lights (this is the slow part - 8100 individual addLight() calls)
    console.time('[GridScene] Generate lights');
    this.generateLights(newSize);
    console.timeEnd('[GridScene] Generate lights');

    // Reinitialize light sources (light count changed)
    if (this.lightMarkers) {
      this.lightMarkers.reinit(this.scene);
    }

    // Update helmet instances for new grid size
    this.createHelmetInstances(newSize);

    // Update controls target
    this.controls.target.set(newSize * 2, 1.75, newSize * 2);
    this.controls.maxDistance = 6 * newSize;
    this.controls.update();
  }

  createUI(pane) {
    const folder = pane.addFolder({ title: 'Grid Scene', expanded: true });

    // Grid size
    folder.addBlade({
      view: 'list',
      label: 'Grid Size',
      options: [
        { text: '8x8 (256)', value: 8 },
        { text: '16x16 (1k)', value: 16 },
        { text: '22x22 (2k)', value: 22 },
        { text: '32x32 (4k)', value: 32 },
        { text: '45x45 (8k)', value: 45 },
        { text: '64x64 (16k)', value: 64 },
        { text: '90x90 (32k)', value: 90 },
      ],
      value: this.params.size
    }).on('change', (ev) => {
      this.updateSize(ev.value);
    });

    // LOD Bias
    folder.addBinding(this.params, 'lightLODBias', {
      label: 'LOD Bias',
      min: 0.1,
      max: 25.0,
      step: 0.1
    }).on('change', (ev) => {
      this.lightsSystem.setLODBias(ev.value);
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

    // Helmet Visibility
    const helmetFolder = folder.addFolder({ title: 'Helmets', expanded: false });

    helmetFolder.addBinding(this.params, 'showHelmets', { label: 'Show Helmets' })
      .on('change', () => {
        this.createHelmetInstances(this.params.size);
      });
  }

  dispose() {
    // Clean up helmet instanced meshes
    if (this.helmetInstancedMesh) {
      if (Array.isArray(this.helmetInstancedMesh)) {
        this.helmetInstancedMesh.forEach(mesh => {
          this.scene.remove(mesh);
          // Geometry and material are shared with original model - don't dispose
        });
      } else {
        this.scene.remove(this.helmetInstancedMesh);
        // Geometry and material are shared with original model - don't dispose
      }
      this.helmetInstancedMesh = null;
    }

    // Clean up the original helmet model
    if (this.helmetModel) {
      this.helmetModel.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(mat => mat.dispose());
        }
      });
    }

    this.scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(mat => mat.dispose());
      }
    });

    this.lightsSystem.dispose();
    this.controls.dispose();
  }
}
