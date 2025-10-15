// Animations.stories.js
import { PlaneGeometry, MeshStandardMaterial, Mesh, Color, Vector3, BoxGeometry } from 'three';
import { createStoryCanvas } from './utils/story-helpers.js';
import { LightMarkers, PulseTarget } from '../index.js';

export default {
  title: 'Animations',
  parameters: {
    docs: {
      description: {
        component: 'Demonstrations of all available light animation types: Wave, Circular, Pulse, Flicker, Linear, and Rotation.',
      },
    },
  },
};

// Wave Animation
export const Wave = () => {
  return createStoryCanvas({
    width: 1200,
    height: 600,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(20, 15, 20);
      controls.target.set(0, 2, 0);

      // Add floor
      const groundGeometry = new PlaneGeometry(40, 40);
      const groundMaterial = new MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Add a row of lights with wave animation
      const colors = [
        new Color(1, 0, 0),
        new Color(1, 0.5, 0),
        new Color(1, 1, 0),
        new Color(0, 1, 0),
        new Color(0, 0.5, 1),
        new Color(0, 0, 1),
        new Color(0.5, 0, 1),
      ];

      colors.forEach((color, i) => {
        lightsSystem.addLight({
          type: 'point',
          position: new Vector3(i * 4 - 12, 2, 0),
          color,
          intensity: 12,
          radius: 10,
          decay: 2,
          animation: {
            wave: {
              axis: [0, 1, 0],
              speed: 1.5,
              amplitude: 2,
              phase: (i / colors.length) * Math.PI * 2
            }
          }
        });
      });

      const lightMarkers = new LightMarkers(lightsSystem, { showGlow: true, pointGlowRadius: 0.4 });
      lightMarkers.init(scene);

      return () => lightMarkers.dispose(scene);
    },
  });
};

Wave.parameters = {
  docs: {
    description: {
      story: 'Wave animation moves lights up and down in a sine wave pattern. Phase offset creates beautiful cascading effects.',
    },
  },
};

// Circular Animation
export const Circular = () => {
  return createStoryCanvas({
    width: 1200,
    height: 600,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(0, 15, 20);
      controls.target.set(0, 2, 0);

      // Add floor
      const groundGeometry = new PlaneGeometry(40, 40);
      const groundMaterial = new MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Add center marker
      const markerGeometry = new BoxGeometry(0.5, 4, 0.5);
      const markerMaterial = new MeshStandardMaterial({ color: 0x666666 });
      const marker = new Mesh(markerGeometry, markerMaterial);
      marker.position.y = 2;
      scene.add(marker);
      lightsSystem.patchMaterial(markerMaterial);

      // Add lights with circular animation
      const lights = [
        {
          position: new Vector3(5, 3, 0),
          color: new Color(1, 0.3, 0.3),
          intensity: 15,
          radius: 12,
          animation: { circular: { speed: 1, radius: 5 } }
        },
        {
          position: new Vector3(-5, 3, 0),
          color: new Color(0.3, 1, 0.3),
          intensity: 15,
          radius: 12,
          animation: { circular: { speed: -0.8, radius: 5 } }
        },
        {
          position: new Vector3(0, 3, 5),
          color: new Color(0.3, 0.3, 1),
          intensity: 15,
          radius: 12,
          animation: { circular: { speed: 1.5, radius: 5 } }
        },
      ];

      lights.forEach(light => {
        lightsSystem.addLight({ type: 'point', decay: 2, ...light });
      });

      const lightMarkers = new LightMarkers(lightsSystem, { showGlow: true, pointGlowRadius: 0.5 });
      lightMarkers.init(scene);

      return () => lightMarkers.dispose(scene);
    },
  });
};

Circular.parameters = {
  docs: {
    description: {
      story: 'Circular animation moves lights in a circle around their initial position. Speed and radius are configurable.',
    },
  },
};

// Pulse Animation
export const Pulse = () => {
  return createStoryCanvas({
    width: 1200,
    height: 600,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(0, 10, 15);
      controls.target.set(0, 2, 0);

      // Add floor
      const groundGeometry = new PlaneGeometry(40, 40);
      const groundMaterial = new MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Add test spheres
      for (let i = 0; i < 3; i++) {
        const sphereGeometry = new BoxGeometry(2, 2, 2);
        const sphereMaterial = new MeshStandardMaterial({ color: 0x888888 });
        const sphere = new Mesh(sphereGeometry, sphereMaterial);
        sphere.position.set(i * 8 - 8, 1, 0);
        scene.add(sphere);
        lightsSystem.patchMaterial(sphereMaterial);
      }

      // Add lights with pulse animation
      const lights = [
        {
          position: new Vector3(-8, 4, 0),
          color: new Color(1, 0.3, 0.3),
          intensity: 15,
          radius: 12,
          animation: { pulse: { speed: 2, amount: 0.5, target: PulseTarget.INTENSITY } }
        },
        {
          position: new Vector3(0, 4, 0),
          color: new Color(0.3, 1, 0.3),
          intensity: 15,
          radius: 12,
          animation: { pulse: { speed: 1.5, amount: 0.5, target: PulseTarget.RADIUS } }
        },
        {
          position: new Vector3(8, 4, 0),
          color: new Color(0.3, 0.3, 1),
          intensity: 15,
          radius: 12,
          animation: { pulse: { speed: 1, amount: 0.3, target: PulseTarget.BOTH } }
        },
      ];

      lights.forEach(light => {
        lightsSystem.addLight({ type: 'point', decay: 2, ...light });
      });

      const lightMarkers = new LightMarkers(lightsSystem, { showGlow: true, pointGlowRadius: 0.5 });
      lightMarkers.init(scene);

      return () => lightMarkers.dispose(scene);
    },
  });
};

Pulse.parameters = {
  docs: {
    description: {
      story: 'Pulse animation smoothly varies light intensity, radius, or both. Great for breathing effects and attention-drawing.',
    },
  },
};

// Flicker Animation
export const Flicker = () => {
  return createStoryCanvas({
    width: 1200,
    height: 600,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(0, 8, 12);
      controls.target.set(0, 2, 0);

      // Add floor
      const groundGeometry = new PlaneGeometry(40, 40);
      const groundMaterial = new MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Add torches (simulated with boxes)
      for (let i = 0; i < 3; i++) {
        const torchGeometry = new BoxGeometry(0.5, 3, 0.5);
        const torchMaterial = new MeshStandardMaterial({ color: 0x3a2a1a });
        const torch = new Mesh(torchGeometry, torchMaterial);
        torch.position.set(i * 8 - 8, 1.5, 0);
        scene.add(torch);
        lightsSystem.patchMaterial(torchMaterial);
      }

      // Add lights with flicker animation (simulating fire)
      const lights = [
        {
          position: new Vector3(-8, 3.5, 0),
          color: new Color(1, 0.6, 0.2),
          intensity: 18,
          radius: 10,
          animation: { flicker: { speed: 12, intensity: 0.4, seed: 1 } }
        },
        {
          position: new Vector3(0, 3.5, 0),
          color: new Color(1, 0.5, 0.1),
          intensity: 18,
          radius: 10,
          animation: { flicker: { speed: 10, intensity: 0.3, seed: 42 } }
        },
        {
          position: new Vector3(8, 3.5, 0),
          color: new Color(1, 0.7, 0.3),
          intensity: 18,
          radius: 10,
          animation: { flicker: { speed: 15, intensity: 0.5, seed: 123 } }
        },
      ];

      lights.forEach(light => {
        lightsSystem.addLight({ type: 'point', decay: 2, ...light });
      });

      const lightMarkers = new LightMarkers(lightsSystem, { showGlow: true, pointGlowRadius: 0.4 });
      lightMarkers.init(scene);

      return () => lightMarkers.dispose(scene);
    },
  });
};

Flicker.parameters = {
  docs: {
    description: {
      story: 'Flicker animation creates random intensity variations, perfect for fire, candles, or damaged lights.',
    },
  },
};

// Combined Animations
export const Combined = () => {
  return createStoryCanvas({
    width: 1200,
    height: 800,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(25, 20, 25);
      controls.target.set(0, 3, 0);

      // Add floor
      const groundGeometry = new PlaneGeometry(50, 50);
      const groundMaterial = new MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Add various objects
      const boxGeometry = new BoxGeometry(3, 3, 3);
      const boxMaterial = new MeshStandardMaterial({ color: 0x666666 });
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          const box = new Mesh(boxGeometry, boxMaterial.clone());
          box.position.set(i * 6 - 12, 1.5, j * 6 - 12);
          scene.add(box);
          lightsSystem.patchMaterial(box.material);
        }
      }

      // Add lights with combined animations
      const lights = [
        {
          position: new Vector3(-10, 5, -10),
          color: new Color(1, 0.3, 0.3),
          intensity: 20,
          radius: 15,
          animation: {
            circular: { speed: 0.8, radius: 4 },
            pulse: { speed: 2, amount: 0.2, target: PulseTarget.INTENSITY }
          }
        },
        {
          position: new Vector3(10, 5, -10),
          color: new Color(0.3, 1, 0.3),
          intensity: 20,
          radius: 15,
          animation: {
            circular: { speed: -0.6, radius: 4 },
            flicker: { speed: 8, intensity: 0.2, seed: 42 }
          }
        },
        {
          position: new Vector3(-10, 5, 10),
          color: new Color(0.3, 0.3, 1),
          intensity: 20,
          radius: 15,
          animation: {
            wave: { axis: [0, 1, 0], speed: 1, amplitude: 2, phase: 0 },
            pulse: { speed: 1.5, amount: 0.3, target: PulseTarget.RADIUS }
          }
        },
        {
          position: new Vector3(10, 5, 10),
          color: new Color(1, 1, 0.3),
          intensity: 20,
          radius: 15,
          animation: {
            circular: { speed: 1, radius: 5 },
            wave: { axis: [0, 1, 0], speed: 2, amplitude: 1.5, phase: Math.PI }
          }
        },
      ];

      lights.forEach(light => {
        lightsSystem.addLight({ type: 'point', decay: 2, ...light });
      });

      const lightMarkers = new LightMarkers(lightsSystem, { showGlow: true, pointGlowRadius: 0.5 });
      lightMarkers.init(scene);

      return () => lightMarkers.dispose(scene);
    },
  });
};

Combined.parameters = {
  docs: {
    description: {
      story: 'Multiple animation types can be combined on a single light for complex, dynamic effects.',
    },
  },
};

