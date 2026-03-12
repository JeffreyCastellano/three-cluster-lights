// Shadows.stories.js - Shadow atlas system demonstrations
import {
  PlaneGeometry, MeshStandardMaterial, Mesh, Color, Vector3,
  BoxGeometry, SphereGeometry, CylinderGeometry
} from 'three';
import { createStoryCanvas } from './utils/story-helpers.js';
import { LightMarkers, PulseTarget } from '../index.js';

export default {
  title: 'Shadows',
  parameters: {
    docs: {
      description: {
        component: 'Demonstrates the clustered shadow atlas system with budget-based temporal rendering. Only the most important lights cast shadows each frame.',
      },
    },
  },
};

// Basic Shadow Demo
export const BasicShadows = () => {
  return createStoryCanvas({
    width: 1200,
    height: 800,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(18, 22, 22);
      controls.target.set(0, 2, 0);
      controls.maxDistance = 80;

      // Floor
      const groundGeometry = new PlaneGeometry(60, 60);
      const groundMaterial = new MeshStandardMaterial({ color: 0x303030, roughness: 0.8 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Central pedestal with sphere
      const pedestalGeom = new BoxGeometry(2, 0.5, 2);
      const pedestalMat = new MeshStandardMaterial({ color: 0x808080, roughness: 0.7 });
      const pedestal = new Mesh(pedestalGeom, pedestalMat);
      pedestal.position.set(0, 0.25, 0);
      scene.add(pedestal);
      lightsSystem.patchMaterial(pedestalMat);

      const sphereGeom = new SphereGeometry(1.2);
      const sphereMat = new MeshStandardMaterial({ color: 0xdddddd, roughness: 0.2, metalness: 0.8 });
      const sphere = new Mesh(sphereGeom, sphereMat);
      sphere.position.set(0, 1.7, 0);
      scene.add(sphere);
      lightsSystem.patchMaterial(sphereMat);

      // Columns
      const colGeom = new CylinderGeometry(0.5, 0.5, 6, 16);
      const colMat = new MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.7 });
      [[-6, 3, -6], [6, 3, -6], [-6, 3, 6], [6, 3, 6]].forEach(pos => {
        const col = new Mesh(colGeom, colMat);
        col.position.set(...pos);
        scene.add(col);
      });
      lightsSystem.patchMaterial(colMat);

      // Back wall
      const wallGeom = new BoxGeometry(30, 10, 0.5);
      const wallMat = new MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.7 });
      const wall = new Mesh(wallGeom, wallMat);
      wall.position.set(0, 5, -15);
      scene.add(wall);
      lightsSystem.patchMaterial(wallMat);

      // Enable shadows
      lightsSystem.setShadowsEnabled(true);
      lightsSystem.setShadowBudget(8, 4);

      // Shadow-casting key lights
      const keyLight1 = lightsSystem.addLight({
        type: 'point',
        position: new Vector3(-8, 10, -4),
        color: new Color(1, 0.85, 0.6),
        intensity: 25,
        radius: 20,
        decay: 2,
      });
      lightsSystem.setLightShadow('point', keyLight1, true, 0.7);

      const keyLight2 = lightsSystem.addLight({
        type: 'point',
        position: new Vector3(8, 12, 4),
        color: new Color(0.6, 0.8, 1),
        intensity: 20,
        radius: 22,
        decay: 2,
      });
      lightsSystem.setLightShadow('point', keyLight2, true, 0.7);

      // Shadow-casting spot
      const spotIdx = lightsSystem.addLight({
        type: 'spot',
        position: new Vector3(0, 14, 0),
        color: new Color(1, 1, 0.9),
        intensity: 40,
        radius: 25,
        decay: 2,
        direction: new Vector3(0, -1, 0),
        angle: Math.PI / 4,
        penumbra: 0.3,
      });
      lightsSystem.setLightShadow('spot', spotIdx, true, 0.7);

      // Non-shadow fill lights
      [
        { pos: new Vector3(-15, 3, 0), color: new Color(0.4, 0.3, 0.6), intensity: 8, radius: 15 },
        { pos: new Vector3(15, 3, 0), color: new Color(0.6, 0.4, 0.3), intensity: 8, radius: 15 },
        { pos: new Vector3(0, 2, 12), color: new Color(0.3, 0.5, 0.4), intensity: 6, radius: 12 },
      ].forEach(fl => {
        lightsSystem.addLight({
          type: 'point',
          position: fl.pos,
          color: fl.color,
          intensity: fl.intensity,
          radius: fl.radius,
          decay: 2,
        });
      });

      // Light markers
      const lightMarkers = new LightMarkers(lightsSystem, {
        showGlow: true,
        pointGlowRadius: 0.4,
        spotGlowRadius: 0.5,
      });
      lightMarkers.init(scene);

      return () => {
        lightMarkers.dispose(scene);
      };
    },
  });
};

BasicShadows.parameters = {
  docs: {
    description: {
      story: 'Basic shadow demo with a budget of 8 shadow-casting lights. Warm and cool key lights plus an overhead spot cast shadows, while fill lights provide ambient illumination without shadows.',
    },
  },
};

// Shadow Budget Comparison
export const ShadowBudget = () => {
  return createStoryCanvas({
    width: 1200,
    height: 800,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(0, 20, 25);
      controls.target.set(0, 2, 0);
      controls.maxDistance = 60;

      // Floor
      const groundGeometry = new PlaneGeometry(40, 40);
      const groundMaterial = new MeshStandardMaterial({ color: 0x303030, roughness: 0.8 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Grid of boxes to show shadow patterns
      const boxGeom = new BoxGeometry(1.5, 3, 1.5);
      const boxMat = new MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 });
      for (let x = -3; x <= 3; x++) {
        for (let z = -3; z <= 3; z++) {
          const box = new Mesh(boxGeom, boxMat);
          box.position.set(x * 4, 1.5, z * 4);
          scene.add(box);
        }
      }
      lightsSystem.patchMaterial(boxMat);

      // Enable shadows with a tight budget to show prioritization
      lightsSystem.setShadowsEnabled(true);
      lightsSystem.setShadowBudget(4, 2); // Only 4 shadow lights, 2 rendered per frame

      // Many colored lights - only the closest/brightest will get shadows
      const colors = [
        new Color(1, 0.3, 0.2),
        new Color(0.2, 1, 0.3),
        new Color(0.2, 0.3, 1),
        new Color(1, 1, 0.2),
        new Color(1, 0.2, 1),
        new Color(0.2, 1, 1),
        new Color(1, 0.6, 0.2),
        new Color(0.6, 0.2, 1),
      ];

      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const r = 12;
        const idx = lightsSystem.addLight({
          type: 'point',
          position: new Vector3(Math.cos(angle) * r, 8, Math.sin(angle) * r),
          color: colors[i],
          intensity: 20,
          radius: 18,
          decay: 2,
        });
        lightsSystem.setLightShadow('point', idx, true, 0.6);
      }

      // Light markers
      const lightMarkers = new LightMarkers(lightsSystem, {
        showGlow: true,
        pointGlowRadius: 0.3,
      });
      lightMarkers.init(scene);

      return () => {
        lightMarkers.dispose(scene);
      };
    },
  });
};

ShadowBudget.parameters = {
  docs: {
    description: {
      story: 'Demonstrates shadow budget prioritization. 8 lights request shadows but only 4 can cast them simultaneously, with 2 re-rendered per frame. The system selects the most important lights based on distance and brightness.',
    },
  },
};

// Animated Shadow Casters
export const AnimatedShadows = () => {
  return createStoryCanvas({
    width: 1200,
    height: 800,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(15, 18, 15);
      controls.target.set(0, 2, 0);
      controls.maxDistance = 60;

      // Floor
      const groundGeometry = new PlaneGeometry(50, 50);
      const groundMaterial = new MeshStandardMaterial({ color: 0x252525, roughness: 0.8 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Objects to cast shadows on
      const objMat = new MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.3 });
      lightsSystem.patchMaterial(objMat);

      // Central sphere
      const centerSphere = new Mesh(new SphereGeometry(2), objMat);
      centerSphere.position.set(0, 2, 0);
      scene.add(centerSphere);

      // Surrounding boxes
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const box = new Mesh(new BoxGeometry(1.5, 2 + i * 0.5, 1.5), objMat);
        box.position.set(Math.cos(angle) * 6, (2 + i * 0.5) / 2, Math.sin(angle) * 6);
        scene.add(box);
      }

      // Enable shadows
      lightsSystem.setShadowsEnabled(true);
      lightsSystem.setShadowBudget(6, 3);

      // Animated shadow-casting spot light (orbiting overhead)
      const spot1 = lightsSystem.addLight({
        type: 'spot',
        position: new Vector3(0, 12, 0),
        color: new Color(1, 0.9, 0.7),
        intensity: 50,
        radius: 25,
        decay: 2,
        direction: new Vector3(0, -1, 0),
        angle: Math.PI / 4,
        penumbra: 0.3,
        animation: {
          rotation: { axis: [0, 1, 0], speed: 0.5, mode: 'continuous' }
        }
      });
      lightsSystem.setLightShadow('spot', spot1, true, 0.8);

      // Pulsing shadow-casting point lights
      const pulseColors = [
        new Color(1, 0.3, 0.3),
        new Color(0.3, 0.3, 1),
        new Color(0.3, 1, 0.3),
      ];

      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        const idx = lightsSystem.addLight({
          type: 'point',
          position: new Vector3(Math.cos(angle) * 10, 6, Math.sin(angle) * 10),
          color: pulseColors[i],
          intensity: 18,
          radius: 16,
          decay: 2,
          animation: {
            pulse: { speed: 1 + i * 0.4, amount: 0.3, target: PulseTarget.INTENSITY }
          }
        });
        lightsSystem.setLightShadow('point', idx, true, 0.6);
      }

      // Light markers
      const lightMarkers = new LightMarkers(lightsSystem, {
        showGlow: true,
        pointGlowRadius: 0.3,
        spotGlowRadius: 0.5,
      });
      lightMarkers.init(scene);

      return () => {
        lightMarkers.dispose(scene);
      };
    },
  });
};

AnimatedShadows.parameters = {
  docs: {
    description: {
      story: 'Shadow-casting lights with animations. An orbiting spot light and pulsing point lights demonstrate how the temporal cache re-renders shadow maps only when lights move or change, keeping GPU cost low.',
    },
  },
};
