// story-helpers.js - Utilities for creating Three.js stories
import { WebGLRenderer, PerspectiveCamera, Scene, Clock, Vector3, AmbientLight, ACESFilmicToneMapping } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ClusterLightingSystem, loadWasm } from '../../index.js';

let wasmModule = null;

export async function getWasmModule() {
  if (!wasmModule) {
    wasmModule = await loadWasm({ preferSIMD: true });
  }
  return wasmModule;
}

export function createRenderer(container) {
  const renderer = new WebGLRenderer({
    alpha: false,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  
  // Get container dimensions - use offsetHeight for actual rendered height
  const width = container.offsetWidth || container.clientWidth || 800;
  const height = container.offsetHeight || container.clientHeight || 600;
  
  console.log(`Creating renderer: container dimensions ${width}x${height}`);
  
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = false;
  
  // Make canvas fill container completely
  renderer.domElement.style.cssText = `
    width: 100%;
    height: 100%;
    display: block;
    position: absolute;
    top: 0;
    left: 0;
  `;
  
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createCamera(aspect = 1) {
  const camera = new PerspectiveCamera(45, aspect, 0.1, 200);
  camera.position.set(20, 15, 20);
  return camera;
}

export function createControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxDistance = 50;
  controls.minDistance = 5;
  controls.update();
  return controls;
}

export async function createLightingSystem(renderer) {
  const wasm = await getWasmModule();
  const system = new ClusterLightingSystem(
    renderer,
    wasm,
    0.1,    // near
    200,    // far
    32, 16, 32,  // cluster resolution
    true    // performance mode
  );
  
  // Disable GPU query warnings for Storybook (no performance UI)
  if (system.assignQuery) {
    system.assignQuery.start = () => {};
    system.assignQuery.end = () => {};
  }
  
  return system;
}

export function createBasicScene() {
  const scene = new Scene();
  const ambientLight = new AmbientLight(0xffffff, 0.02);
  scene.add(ambientLight);
  return scene;
}

export function createStoryCanvas(options = {}) {
  const {
    width = 800,
    height = 600,
    setup,
    update,
    onCleanup
  } = options;

  const container = document.createElement('div');
  container.className = 'story-canvas-wrapper';
  container.style.cssText = `
    width: 100%;
    height: 100%;
    min-height: ${height}px;
    position: relative;
    display: block;
    overflow: hidden;
  `;

  // Create unique ID for this story instance to prevent cross-contamination
  const instanceId = `story-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  container.dataset.instanceId = instanceId;

  let renderer, camera, controls, scene, lightsSystem, clock, animationId;
  let isRunning = false;
  let cleanupFn = null;
  let isInitialized = false;
  let handleResize = null;

  // Cleanup function - defined in outer scope so it can be called by Storybook
  const cleanup = () => {
    console.log(`[${instanceId}] Cleaning up story...`);
    
    // Stop animation immediately
    isRunning = false;
    isInitialized = false;
    
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    
    if (handleResize) {
      window.removeEventListener('resize', handleResize);
      handleResize = null;
    }

    if (cleanupFn) {
      try {
        cleanupFn();
      } catch (error) {
        console.error(`[${instanceId}] Error in cleanup function:`, error);
      }
      cleanupFn = null;
    }

    if (onCleanup) {
      try {
        onCleanup({ scene, lightsSystem });
      } catch (error) {
        console.error(`[${instanceId}] Error in onCleanup:`, error);
      }
    }

    // Dispose controls first (releases DOM events)
    if (controls) {
      try {
        controls.dispose();
      } catch (error) {
        console.error(`[${instanceId}] Error disposing controls:`, error);
      }
      controls = null;
    }
    
    // Dispose lighting system
    if (lightsSystem) {
      try {
        // Clear all lights from WASM memory before disposal
        lightsSystem.clearLights();
        lightsSystem.dispose();
      } catch (error) {
        console.error(`[${instanceId}] Error disposing lighting system:`, error);
      }
      lightsSystem = null;
    }
    
    // Dispose scene
    if (scene) {
      try {
        scene.traverse((object) => {
          if (object.geometry) object.geometry.dispose();
          if (object.material) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(mat => {
              if (mat.dispose) mat.dispose();
            });
          }
        });
        scene.clear();
      } catch (error) {
        console.error(`[${instanceId}] Error disposing scene:`, error);
      }
      scene = null;
    }
    
    // Dispose renderer last
    if (renderer) {
      try {
        renderer.dispose();
        if (container && renderer.domElement && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      } catch (error) {
        console.error(`[${instanceId}] Error disposing renderer:`, error);
      }
      renderer = null;
    }
    
    camera = null;
    clock = null;
    
    console.log(`[${instanceId}] Cleanup complete`);
  };

  const init = async () => {
    try {
      // Prevent re-initialization
      if (isInitialized) {
        console.warn(`[${instanceId}] Already initialized, skipping`);
        return;
      }
      
      console.log(`[${instanceId}] Initializing story...`);
      
      renderer = createRenderer(container);
      
      // Get actual rendered size from renderer
      const renderWidth = renderer.domElement.width;
      const renderHeight = renderer.domElement.height;
      
      camera = createCamera(renderWidth / renderHeight);
      scene = createBasicScene();
      controls = createControls(camera, renderer.domElement);
      lightsSystem = await createLightingSystem(renderer);
      clock = new Clock();
      
      isInitialized = true;

      // Update camera aspect ratio to match actual canvas
      camera.aspect = renderWidth / renderHeight;
      camera.updateProjectionMatrix();
      
      // CRITICAL: Set the size on the lighting system using actual canvas dimensions
      lightsSystem.size.value.set(renderWidth, renderHeight);
      
      // Initialize lighting system size
      lightsSystem.resize();

      // CRITICAL: Clear any lights from previous stories (WASM module is shared)
      const prevLightCount = lightsSystem.pointLightCount + lightsSystem.spotLightCount + lightsSystem.rectLightCount;
      if (prevLightCount > 0) {
        console.log(`[${instanceId}] Clearing ${prevLightCount} lights from previous story`);
      }
      lightsSystem.clearLights();

      // Call setup function
      if (setup) {
        cleanupFn = await setup({ scene, camera, renderer, lightsSystem, controls });
      }

      // After lights are added, ensure render targets are sized correctly
      // (updateLightTextures is called automatically by addLight, but we need to ensure render targets match)
      if (lightsSystem.pointLightCount > 0 || lightsSystem.spotLightCount > 0 || lightsSystem.rectLightCount > 0) {
        // Get current canvas size again (might have changed)
        const canvasWidth = renderer.domElement.width;
        const canvasHeight = renderer.domElement.height;
        
        // Ensure lighting system size is correct
        lightsSystem.size.value.set(canvasWidth, canvasHeight);
        
        // Recreate render targets at correct size
        lightsSystem.resize();
        
        console.log(`[${instanceId}] Scene ready with ${lightsSystem.pointLightCount} point, ${lightsSystem.spotLightCount} spot, ${lightsSystem.rectLightCount} rect lights (${canvasWidth}x${canvasHeight})`);
      } else {
        console.log(`[${instanceId}] Scene ready (no lights)`);
      }

      isRunning = true;

      // Animation loop
      function animate() {
        // Double-check we should still be running
        if (!isRunning || !isInitialized) {
          console.log(`[${instanceId}] Stopping animation (running: ${isRunning}, initialized: ${isInitialized})`);
          return;
        }
        
        animationId = requestAnimationFrame(animate);

        const time = clock.getElapsedTime();
        
        // Safety check: ensure controls exist
        if (controls && controls.enabled) {
          controls.update();
        }
        
        if (update) {
          update({ scene, camera, renderer, lightsSystem, time, controls });
        }

        // Update lighting system (matches BaseScene.render pattern)
        if (lightsSystem) {
          lightsSystem.update(time, camera, scene);
        }
        
        if (renderer && scene && camera) {
          renderer.render(scene, camera);
        }
      }
      
      // Start animation loop after a small delay to ensure setup is complete
      requestAnimationFrame(() => {
        animate();
      });

      // Handle resize
      handleResize = () => {
        const width = container.offsetWidth || container.clientWidth || 800;
        const height = container.offsetHeight || container.clientHeight || 600;
        
        // Update renderer size
        renderer.setSize(width, height);
        
        // Get actual canvas buffer dimensions (may differ due to pixel ratio)
        const canvasWidth = renderer.domElement.width;
        const canvasHeight = renderer.domElement.height;
        
        // Update camera aspect ratio to match actual canvas dimensions
        camera.aspect = canvasWidth / canvasHeight;
        camera.updateProjectionMatrix();
        
        // Update lighting system with actual canvas size
        lightsSystem.size.value.set(canvasWidth, canvasHeight);
        lightsSystem.resize();
        
        console.log(`Resized: ${canvasWidth}x${canvasHeight}, aspect: ${camera.aspect.toFixed(2)}`);
      };

      window.addEventListener('resize', handleResize);

    } catch (error) {
      console.error(`[${instanceId}] Error initializing story:`, error);
      container.innerHTML = `<div style="color: red; padding: 20px;">Error: ${error.message}</div>`;
      isInitialized = false;
    }
  };

  // Defer initialization until container is in DOM and has proper dimensions
  // Use requestAnimationFrame to ensure Storybook has added container to DOM
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Double RAF to ensure layout is complete
      init();
    });
  });
  
  // Add cleanup to container so Storybook can call it
  container.cleanup = cleanup;

  return container;
}

