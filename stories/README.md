# Three Cluster Lights - Storybook

Interactive examples and documentation for the three-cluster-lights library.

## 📚 Live Documentation

Visit the live Storybook documentation at: **https://jeffreycastellano.github.io/three-cluster-lights/**

## 🚀 Getting Started

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Run Storybook locally:
```bash
npm run storybook
```

3. Open your browser to `http://localhost:6006`

### Building for Production

Build the static Storybook site:
```bash
npm run build-storybook
```

The output will be in the `storybook-static` directory.

## 📖 Available Stories

### Introduction
Overview of the three-cluster-lights library, features, and quick start guide.

### Examples

#### Basic Example
- **Grid 8×8** - 256 lights with mixed animations
- **Grid 16×16** - 1,024 lights demonstration
- **Grid 22×22** - 1,936 lights stress test
- **Grid 32×32** - 4,096 lights extreme test

#### Light Types
- **Point Lights** - Omnidirectional lighting
- **Spot Lights** - Directional cone lighting with angle/penumbra
- **Rectangle Lights** - Area lighting with rotation
- **Mixed Lights** - All three types together

#### Animations
- **Circular** - Circular motion around initial position
- **Pulse** - Smooth intensity/radius variations
- **Flicker** - Random flickering (fire effects)
- **Wave** - Sine wave vertical motion
- **Combined** - Multiple animations on single lights

## 🎨 Customization

Each story includes interactive controls to:
- Adjust grid sizes
- Toggle light markers
- Modify LOD bias
- Change animation parameters
- Adjust light properties in real-time

## 🔧 Technical Details

### Story Structure

Stories are located in `/stories` and use the following structure:

```javascript
import { createStoryCanvas } from './utils/story-helpers.js';

export const MyStory = () => {
  return createStoryCanvas({
    width: 1200,
    height: 800,
    setup: async ({ scene, camera, lightsSystem, controls }) => {
      // Initialize scene, add objects, configure lights
      
      return () => {
        // Cleanup function
      };
    },
    update: ({ scene, lightsSystem, time }) => {
      // Per-frame updates (optional)
    },
  });
};
```

### Helper Utilities

The `story-helpers.js` module provides:
- `createStoryCanvas()` - Main canvas wrapper with animation loop
- `createRenderer()` - WebGL renderer setup
- `createCamera()` - Perspective camera configuration
- `createControls()` - Orbit controls
- `createLightingSystem()` - Async lighting system initialization
- `getWasmModule()` - Cached WASM module loading

## 📦 Deployment

The Storybook is automatically deployed to GitHub Pages via GitHub Actions:

1. Push to `main` branch
2. GitHub Actions builds Storybook
3. Deploys to `gh-pages` branch
4. Available at `https://jeffreycastellano.github.io/three-cluster-lights/`

### Manual Deployment

To deploy manually:

```bash
# Build storybook
npm run build-storybook

# Deploy to GitHub Pages (requires gh-pages package)
npx gh-pages -d storybook-static
```

## 🐛 Troubleshooting

### WASM Loading Issues

If stories fail to load with WASM errors:
- Ensure WASM files are in `/wasm` directory
- Check that `staticDirs` in `.storybook/main.js` includes the correct path
- Verify CORS headers allow WASM loading

### Performance Issues

For better performance:
- Use smaller grid sizes (8×8 or 16×16)
- Disable light markers on large scenes
- Increase LOD bias value
- Use Chrome/Firefox with hardware acceleration enabled

### Canvas Not Rendering

If the canvas appears blank:
- Check browser console for errors
- Verify WebGL 2 support in your browser
- Ensure Three.js version compatibility

## 📝 Contributing

To add new stories:

1. Create a new `.stories.js` file in `/stories`
2. Import the story helpers
3. Define your default export and stories
4. Add interactive controls using Storybook's `argTypes`
5. Test locally with `npm run storybook`
6. Submit a pull request

## 🔗 Resources

- [Storybook Documentation](https://storybook.js.org/)
- [Three.js Documentation](https://threejs.org/docs/)
- [Three Cluster Lights README](../README.md)
- [API Documentation](../README.md#api-documentation)

## 📄 License

MIT - See [LICENSE](../LICENSE) for details.

