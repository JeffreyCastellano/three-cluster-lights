// LightTypes.stories.js
import { 
  PlaneGeometry, MeshStandardMaterial, Mesh, Color, Vector3, 
  BoxGeometry, SphereGeometry, TorusGeometry ,AmbientLight
} from 'three';
import { createStoryCanvas } from './utils/story-helpers.js';
import { LightMarkers, PulseTarget } from '../index.js';

export default {
  title: 'Light Types',
  parameters: {
    docs: {
      description: {
        component: 'Demonstrations of all supported light types: Point, Spot, and Rectangle lights with various configurations.',
      },
    },
  },
};

// Point Lights Story
export const PointLights = () => {
  return createStoryCanvas({
    width: 1200,
    height: 800,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(15, 10, 15);
      controls.target.set(0, 2, 0);

      // Add floor
      const groundGeometry = new PlaneGeometry(40, 40);
      const groundMaterial = new MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Add test spheres
      for (let i = 0; i < 4; i++) {
        const sphereGeometry = new SphereGeometry(1.5);
        const sphereMaterial = new MeshStandardMaterial({
          color: 'white',
          roughness: i * 0.25,
          metalness: 0,
        });
        const sphere = new Mesh(sphereGeometry, sphereMaterial);
        sphere.position.set(i * 4 - 6, 1.5, -5);
        scene.add(sphere);
        lightsSystem.patchMaterial(sphereMaterial);
      }

      // Add point lights with different colors and animations
      const pointLights = [
        {
          position: new Vector3(-8, 4, 0),
          color: new Color(1, 0.2, 0.2),
          intensity: 10,
          radius: 15,
          animation: {
            circular: { speed: 0.5, radius: 3 },
            pulse: { speed: 2, amount: 0.2, target: PulseTarget.INTENSITY }
          }
        },
        {
          position: new Vector3(0, 4, 0),
          color: new Color(0.2, 1, 0.2),
          intensity: 10,
          radius: 15,
          animation: {
            pulse: { speed: 0.5, amount: 0.3, target: PulseTarget.RADIUS }
          }
        },
        {
          position: new Vector3(8, 4, 0),
          color: new Color(0.2, 0.2, 1),
          intensity: 10,
          radius: 15,
          animation: {
            flicker: { speed: 10, intensity: 0.3, seed: 42 }
          }
        },
      ];

      pointLights.forEach(light => {
        lightsSystem.addLight({ type: 'point', decay: 2, ...light });
      });

      // Add light markers
      const lightMarkers = new LightMarkers(lightsSystem, {
        showGlow: true,
        pointGlowRadius: 0.25,
        markerScale: 0.05,
      });
      lightMarkers.init(scene);

      return () => {
        lightMarkers.dispose(scene);
      };
    },
  });
};

PointLights.parameters = {
  docs: {
    description: {
      story: 'Point lights emit light in all directions from a single point. They support animations like circular motion, pulse, and flicker.',
    },
  },
};

// Spot Lights Story
export const SpotLights = () => {
  return createStoryCanvas({
    width: 1200,
    height: 800,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(20, 15, 20);
      controls.target.set(0, 3, 0);

      // Add floor
      const groundGeometry = new PlaneGeometry(140, 140);
      const groundMaterial = new MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);
      const light = new AmbientLight(0xffffff, 0.5);
      scene.add(light);
      // Add target objects
      const boxGeometry = new BoxGeometry(1, 2, 1);
      const boxMaterial = new MeshStandardMaterial({ color: 0xffffff });
      const box = new Mesh(boxGeometry, boxMaterial);
      box.position.set(-8, 0, 9);
      scene.add(box);
      lightsSystem.patchMaterial(boxMaterial);

      const sphereGeometry = new SphereGeometry(1);
      const sphereMaterial = new MeshStandardMaterial({ color: 0xffffff, metalness: 0.5 });
      const sphere = new Mesh(sphereGeometry, sphereMaterial);
      sphere.position.set(0, 1.5, 8);
      scene.add(sphere);
      lightsSystem.patchMaterial(sphereMaterial);

      const torusGeometry = new TorusGeometry(1.5, 0.5, 16, 32);
      const torusMaterial = new MeshStandardMaterial({ color: 0xffffff });
      const torus = new Mesh(torusGeometry, torusMaterial);
      torus.position.set(6, 1.8, 8);
      torus.rotation.set(-Math.PI / 4, 0, 0);
      scene.add(torus);
      lightsSystem.patchMaterial(torusMaterial);

      // Add spot lights
      const spotLights = [
        {
          position: new Vector3(-6, 4, 8),
          direction: new Vector3(0, 1, -0.5).normalize(),
          color: new Color(1, 0.3, 0.3),
          intensity: 140,
          radius: 20,
          angle: 0,
          penumbra: 2.0,
          animation: {
            rotation: { axis: [0, 1, 0], speed: 1.5, mode: 'continuous' },
          }
        },
        {
          position: new Vector3(0, 4, 8),
          direction: new Vector3(0, 1, -0.5).normalize(),
          color: new Color(0.3, 1, 0.3),
          intensity: 140,
          radius: 20,
          angle: 0,
          penumbra: 0.5,
          animation: {
            rotation: { axis: [0, 1, 0], speed: 1, mode: 'continuous' },
          }
        },
        {
          position: new Vector3(6, 4, 8),
          direction: new Vector3(0, 1, -0.5).normalize(),
          color: new Color(0.3, 0.3, 1),
          intensity: 140,
          radius: 20,
          angle: 0,
          penumbra: 0.1,
          animation: {
            rotation: { axis: [0, 1, 0], speed: 2, mode: 'continuous' },
          }
        },
      ];

      spotLights.forEach(light => {
        lightsSystem.addLight({ type: 'spot', decay: 2, ...light });
      });

      // Add light markers
      const lightMarkers = new LightMarkers(lightsSystem, {
        showGlow: true,
        spotGlowRadius: 0.5,
      });
      lightMarkers.init(scene);

      return () => {
        lightMarkers.dispose(scene);
      };
    },
  });
};

SpotLights.parameters = {
  docs: {
    description: {
      story: 'Spot lights emit light in a cone from a position with a direction. They support angle, penumbra, rotation animations, and more.',
    },
  },
};

// Rectangle Lights Story
export const RectangleLights = () => {
  return createStoryCanvas({
    width: 1200,
    height: 800,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(0, 15, 25);
      controls.target.set(0, 3, 0);

      // Add floor
      const groundGeometry = new PlaneGeometry(40, 40);
      const groundMaterial = new MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Add walls
      const wallGeometry = new BoxGeometry(0.5, 12, 30);
      const wallMaterial = new MeshStandardMaterial({ color: 0x404040 });
      
      const leftWall = new Mesh(wallGeometry, wallMaterial);
      leftWall.position.set(-15, 6, 0);
      scene.add(leftWall);
      lightsSystem.patchMaterial(wallMaterial);

      const rightWall = leftWall.clone();
      rightWall.position.set(15, 6, 0);
      scene.add(rightWall);

      const backWallGeometry = new BoxGeometry(30, 12, 0.5);
      const backWall = new Mesh(backWallGeometry, wallMaterial.clone());
      backWall.position.set(0, 6, -15);
      scene.add(backWall);
      lightsSystem.patchMaterial(backWall.material);

      // Add objects
      for (let i = 0; i < 5; i++) {
        const sphereGeometry = new SphereGeometry(1);
        const sphereMaterial = new MeshStandardMaterial({
          color: new Color().setHSL(i / 5, 0.7, 0.5),
          roughness: 0.3,
          metalness: 0.7,
        });
        const sphere = new Mesh(sphereGeometry, sphereMaterial);
        sphere.position.set(i * 5 - 10, 1, -5);
        scene.add(sphere);
        lightsSystem.patchMaterial(sphereMaterial);
      }

      // Add rectangle lights
      const rectLights = [
        {
          position: new Vector3(-14.5, 6, -10),
          width: 6,
          height: 8,
          normal: new Vector3(1, 0, 0),
          color: new Color(1, 0.4, 0.3),
          intensity: 50,
          decay: 1,
          radius: 25,
          animation: {
            pulse: { speed: 2.5, amount: 0.01, target: PulseTarget.INTENSITY }
          }
        }
      ];

      rectLights.forEach(light => {
        lightsSystem.addLight({ type: 'rect', ...light });
      });

      // Add light markers
      const lightMarkers = new LightMarkers(lightsSystem, {
        showGlow: true,
        rectGlowRadius: 0.3,
      });
      lightMarkers.init(scene);

      return () => {
        lightMarkers.dispose(scene);
      };
    },
  });
};

RectangleLights.parameters = {
  docs: {
    description: {
      story: 'Rectangle (area) lights emit light from a rectangular surface. They have width, height, and a normal direction for realistic architectural lighting.',
    },
  },
};

// Mixed Lights Story
export const MixedLights = () => {
  return createStoryCanvas({
    width: 1200,
    height: 800,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(25, 20, 25);
      controls.target.set(0, 3, 0);
      controls.maxDistance = 100;

      // Add floor
      const groundGeometry = new PlaneGeometry(60, 60);
      const groundMaterial = new MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Add various objects
      const objects = [
        { geometry: new BoxGeometry(3, 3, 3), position: [-10, 1.5, -10], color: 0xff6b6b },
        { geometry: new SphereGeometry(2), position: [0, 2, -10], color: 0x4ecdc4 },
        { geometry: new TorusGeometry(2, 0.7, 16, 32), position: [10, 2, -10], color: 0xffe66d },
        { geometry: new BoxGeometry(2, 6, 2), position: [-10, 3, 0], color: 0x95e1d3 },
        { geometry: new SphereGeometry(1.5), position: [10, 1.5, 0], color: 0xf38181 },
        { geometry: new TorusGeometry(1.5, 0.5, 16, 32), position: [0, 1.5, 5], color: 0xaa96da },
      ];

      objects.forEach(({ geometry, position, color }) => {
        const material = new MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
        const mesh = new Mesh(geometry, material);
        mesh.position.set(...position);
        scene.add(mesh);
        lightsSystem.patchMaterial(material);
      });

      // Mix of all light types
      const allLights = [
        // Point lights
        { type: 'point', position: new Vector3(-15, 5, -15), color: new Color(1, 0.3, 0.3), intensity: 25, radius: 18, decay: 2 },
        { type: 'point', position: new Vector3(15, 5, -15), color: new Color(0.3, 1, 0.3), intensity: 25, radius: 18, decay: 2 },
        { type: 'point', position: new Vector3(0, 3, 0), color: new Color(0.3, 0.3, 1), intensity: 20, radius: 15, decay: 2,
          animation: { circular: { speed: 0.7, radius: 5 }, pulse: { speed: 2, amount: 0.2, target: PulseTarget.INTENSITY } }
        },
        
        // Spot lights
        { type: 'spot', position: new Vector3(-15, 12, 0), direction: new Vector3(1, -1, 0).normalize(),
          color: new Color(1, 0.8, 0.2), intensity: 50, radius: 25, decay: 2, angle: Math.PI / 6, penumbra: 0.2 },
        { type: 'spot', position: new Vector3(15, 12, 0), direction: new Vector3(-1, -1, 0).normalize(),
          color: new Color(0.2, 0.8, 1), intensity: 50, radius: 25, decay: 2, angle: Math.PI / 5, penumbra: 0.3 },
        
        // Rectangle lights
        { type: 'rect', position: new Vector3(0, 10, -20), width: 15, height: 5, normal: new Vector3(0, -0.2, 1).normalize(),
          color: new Color(1, 1, 0.9), intensity: 60, decay: 0.7, radius: 35 },
      ];

      allLights.forEach(light => lightsSystem.addLight(light));

      // Add light markers
      const lightMarkers = new LightMarkers(lightsSystem, {
        showGlow: true,
        pointGlowRadius: 0.5,
        spotGlowRadius: 0.5,
        rectGlowRadius: 0.3,
      });
      lightMarkers.init(scene);

      return () => {
        lightMarkers.dispose(scene);
      };
    },
  });
};

MixedLights.parameters = {
  docs: {
    description: {
      story: 'A combination of all three light types working together to create complex lighting scenarios.',
    },
  },
};

