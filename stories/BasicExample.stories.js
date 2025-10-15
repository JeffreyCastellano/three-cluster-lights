// BasicExample.stories.js
import { PlaneGeometry, MeshStandardMaterial, Mesh, Color, Vector3 } from 'three';
import { createStoryCanvas } from './utils/story-helpers.js';
import { LightMarkers, PulseTarget } from '../index.js';

export default {
  title: 'Examples/Basic Example',
  parameters: {
    docs: {
      description: {
        component: 'A grid of dynamic lights with various animations including circular motion, pulse, flicker, and wave effects. This demonstrates the core capabilities of the cluster lighting system.',
      },
    },
  },
  argTypes: {
    gridSize: {
      control: { type: 'select' },
      options: [4, 8, 16, 22, 32],
      description: 'Size of the light grid (N×N)',
      table: {
        defaultValue: { summary: 16 },
      },
    },
    showLightMarkers: {
      control: 'boolean',
      description: 'Show visual markers for light positions',
      table: {
        defaultValue: { summary: true },
      },
    },
    lodBias: {
      control: { type: 'range', min: 0.1, max: 25, step: 0.1 },
      description: 'LOD bias for performance tuning',
      table: {
        defaultValue: { summary: 25 },
      },
    },
  },
};

function generateLights(size) {
  const lights = [];
  
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
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

const Template = (args) => {
  return createStoryCanvas({
    width: 1200,
    height: 800,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      // Setup camera
      camera.position.set(args.gridSize * 2, 15, args.gridSize * 2);
      controls.target.set(args.gridSize * 2, 3, args.gridSize * 2);
      controls.maxDistance = 200;
      controls.update();

      // Add ground plane
      const groundGeometry = new PlaneGeometry(args.gridSize * 8, args.gridSize * 8);
      const groundMaterial = new MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.8,
        metalness: 0.2,
      });
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0;
      scene.add(ground);

      // Patch ground material
      lightsSystem.patchMaterial(groundMaterial);

      // Generate and add lights
      const lights = generateLights(args.gridSize);
      lightsSystem.bulkConfigPointLights(lights);

      // Set LOD bias
      lightsSystem.setLODBias(args.lodBias);

      // Add light markers
      let lightMarkers = null;
      if (args.showLightMarkers) {
        lightMarkers = new LightMarkers(lightsSystem, {
          showGlow: true,
          pointGlowRadius: 0.3,
        });
        lightMarkers.init(scene);
      }

      // Return cleanup function
      return () => {
        if (lightMarkers) {
          lightMarkers.dispose(scene);
        }
      };
    },
    update: ({ lightsSystem, args }) => {
      // Update light markers visibility if changed
      // This would need to be handled differently in a real implementation
    },
  });
};

export const Grid8x8 = Template.bind({});
Grid8x8.args = {
  gridSize: 8,
  showLightMarkers: true,
  lodBias: 25,
};
Grid8x8.parameters = {
  docs: {
    description: {
      story: '8×8 grid (256 lights) - Recommended for most applications. Good balance of visual quality and performance.',
    },
  },
};

export const Grid16x16 = Template.bind({});
Grid16x16.args = {
  gridSize: 16,
  showLightMarkers: true,
  lodBias: 25,
};
Grid16x16.parameters = {
  docs: {
    description: {
      story: '16×16 grid (1,024 lights) - High-end GPUs. Demonstrates the systems ability to handle thousands of dynamic lights.',
    },
  },
};

export const Grid22x22 = Template.bind({});
Grid22x22.args = {
  gridSize: 22,
  showLightMarkers: true,
  lodBias: 25,
};
Grid22x22.parameters = {
  docs: {
    description: {
      story: '22×22 grid (1,936 lights) - Stress test configuration with light markers enabled.',
    },
  },
};

export const Grid32x32 = Template.bind({});
Grid32x32.args = {
  gridSize: 32,
  showLightMarkers: true,
  lodBias: 25,
};
Grid32x32.parameters = {
  docs: {
    description: {
      story: '32×32 grid (4,096 lights) - Extreme stress test with light markers enabled. Requires high-end GPU for smooth performance.',
    },
  },
};

