// Test.stories.js - Simple test to verify Storybook is working
import { PlaneGeometry, MeshStandardMaterial, Mesh, Color, Vector3, SphereGeometry } from 'three';
import { createStoryCanvas } from './utils/story-helpers.js';

export default {
  title: 'Test/Basic Setup',
  parameters: {
    docs: {
      description: {
        component: 'Simple test story to verify Three.js and the lighting system are working correctly.',
      },
    },
  },
};

export const SingleLight = () => {
  return createStoryCanvas({
    width: 800,
    height: 600,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      // Setup camera - further away for better view
      camera.position.set(15, 12, 15);
      controls.target.set(0, 1, 0);
      controls.update();

      // Add simple ground
      const groundGeometry = new PlaneGeometry(20, 20);
      const groundMaterial = new MeshStandardMaterial({ 
        color: 0x333333,
        roughness: 0.8,
        metalness: 0.2,
      });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);

      // Patch material
      lightsSystem.patchMaterial(groundMaterial);

      // Add a sphere
      const sphereGeometry = new SphereGeometry(1.5);
      const sphereMaterial = new MeshStandardMaterial({ 
        color: 0xffffff,
        roughness: 0.5,
        metalness: 0.5,
      });
      const sphere = new Mesh(sphereGeometry, sphereMaterial);
      sphere.position.y = 1.5;
      scene.add(sphere);
      lightsSystem.patchMaterial(sphereMaterial);

      // Add just one simple light
      console.log('Adding single point light...');
      const lightIndex = lightsSystem.addLight({
        type: 'point',
        position: new Vector3(5, 5, 5),
        color: new Color(1, 0.8, 0.6),
        intensity: 20,
        radius: 15,
        decay: 2,
      });
      
      console.log('Light added with index:', lightIndex);
      console.log('Point light count:', lightsSystem.pointLightCount);

      // No cleanup needed
      return () => {};
    },
  });
};

SingleLight.parameters = {
  docs: {
    description: {
      story: 'A single point light illuminating a sphere. This is the simplest possible setup to verify everything works.',
    },
  },
};

export const ThreeLights = () => {
  return createStoryCanvas({
    width: 800,
    height: 600,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      camera.position.set(15, 12, 15);
      controls.target.set(0, 1, 0);
      controls.update();

      // Ground
      const groundGeometry = new PlaneGeometry(20, 20);
      const groundMaterial = new MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      lightsSystem.patchMaterial(groundMaterial);

      // Sphere
      const sphereGeometry = new SphereGeometry(1.5);
      const sphereMaterial = new MeshStandardMaterial({ color: 0xffffff });
      const sphere = new Mesh(sphereGeometry, sphereMaterial);
      sphere.position.y = 1.5;
      scene.add(sphere);
      lightsSystem.patchMaterial(sphereMaterial);

      // Add three lights with different colors
      const lights = [
        { position: new Vector3(5, 5, 5), color: new Color(1, 0.3, 0.3) },
        { position: new Vector3(-5, 5, 0), color: new Color(0.3, 1, 0.3) },
        { position: new Vector3(0, 5, -5), color: new Color(0.3, 0.3, 1) },
      ];

      console.log('Adding three lights...');
      lights.forEach((light, i) => {
        const index = lightsSystem.addLight({
          type: 'point',
          position: light.position,
          color: light.color,
          intensity: 15,
          radius: 12,
          decay: 2,
        });
        console.log(`Light ${i} added with index:`, index);
      });

      console.log('Total point lights:', lightsSystem.pointLightCount);

      return () => {};
    },
  });
};

ThreeLights.parameters = {
  docs: {
    description: {
      story: 'Three colored point lights (red, green, blue) illuminating a white sphere.',
    },
  },
};

