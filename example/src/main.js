// main.js - Entry point for Three.js multi-scene implementation
import { WebGLRenderer,ACESFilmicToneMapping } from 'three';
import { SceneManager } from './SceneManager.js';
import { PerformanceTracker } from '../lib/index.js';

try {
  // Create renderer
  const renderer = new WebGLRenderer({
    alpha: false,
    stencil: false, // Disable stencil buffer - not needed
    antialias: false,
    powerPreference: "high-performance"
  });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure=0.5;
  renderer.shadowMap.enabled = false; // CRITICAL: Disable built-in shadows (use cluster system instead)
  renderer.setPixelRatio(window.devicePixelRatio); // Use device's native pixel ratio
  renderer.setSize(window.innerWidth, window.innerHeight);

  const app = document.getElementById('app');
  app.appendChild(renderer.domElement);

  // Check for timer query extension
  const gl = renderer.getContext();
  const timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");

  // Create performance tracker (automatically injects HTML and manages all tracking)
  const perfTracker = new PerformanceTracker(renderer);

  // Create Tweakpane container
  const tweakpaneContainer = document.createElement('div');
  tweakpaneContainer.id = 'tweakpane-container';
  tweakpaneContainer.style.cssText = 'position:absolute;top:10px;right:10px;z-index:1000;';
  document.body.appendChild(tweakpaneContainer);

  // Create scene manager
  const sceneManager = new SceneManager(app, renderer, perfTracker);
  sceneManager.init();


  // Animation loop with performance tracking
  // Using renderer.setAnimationLoop for better mobile performance and 120fps support on ProMotion devices
  renderer.setAnimationLoop(() => {
    perfTracker.begin();
    sceneManager.update();
    perfTracker.end();
  });

  // Handle resize
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    sceneManager.onResize();
  }, false);

  // Handle cleanup
  window.addEventListener('beforeunload', () => {
    perfTracker.dispose();
    sceneManager.dispose();
    renderer.dispose();
  });

} catch (error) {
  console.error('Error initializing app:', error);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.textContent = 'Error: ' + error.message;
    loading.style.color = '#ff5555';
  }
}
