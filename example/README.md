# Three Cluster Lights - Example Application

This is a full-featured example application demonstrating the `three-cluster-lights` library in action.

## 🎮 Live Demo

**[View Live Demo](https://three-cluster-lights.netlify.app)**

## 📚 Documentation

- **[Storybook Documentation](https://jeffreycastellano.github.io/three-cluster-lights/)** - Interactive examples and API documentation
- **[NPM Package](https://www.npmjs.com/package/three-cluster-lights)** - Install via npm
- **[GitHub Repository](https://github.com/jeffreycastellano/three-cluster-lights)** - Source code

## 🚀 Running Locally

### Prerequisites

- Node.js 16+
- npm or your preferred package manager

### Installation

```bash
# Install dependencies
npm install
```

### Development

```bash
# Start development server (usually Vite)
npm run dev
```

The application will open at `http://localhost:5173` (or similar, check console output).

### Build for Production

```bash
# Build static files
npm run build

# Preview production build
npm run preview
```

## 📁 Project Structure

```
example/
├── src/                    # Source code
│   ├── main.js            # Application entry point
│   ├── SceneManager.js    # Scene management
│   └── scenes/            # Different scene demos
├── public/                # Static assets
│   └── assets/
│       ├── models/        # 3D models (.glb)
│       └── textures/      # Textures
├── lib/                   # Local copy of three-cluster-lights
├── index.html             # HTML entry point
└── package.json           # Dependencies and scripts
```

## 🎯 Features Demonstrated

This example showcases:

- ✨ **Multiple light types** (Point, Spot, Rectangle)
- 🎬 **Various animations** (Circular, Pulse, Flicker, Wave)
- 📊 **Performance monitoring** with real-time stats
- 🎨 **Multiple scenes** showing different use cases
- 🔍 **Visual debugging** with light markers
- ⚡ **High light counts** (256 to 4,096+ lights)
- 🎮 **Interactive controls** for tweaking parameters

## 🔧 Technology Stack

- **[Three.js](https://threejs.org/)** - 3D rendering
- **[three-cluster-lights](https://www.npmjs.com/package/three-cluster-lights)** - Clustered lighting system
- **[Vite](https://vitejs.dev/)** - Build tool and dev server
- **WebAssembly** - High-performance light processing

## 📝 Usage as a Template

Feel free to use this example as a starting point for your own projects:

1. Copy the example directory
2. Install dependencies: `npm install`
3. Modify scenes in `src/scenes/`
4. Add your own 3D models to `public/assets/models/`
5. Customize the lighting setup in `SceneManager.js`

## 🐛 Troubleshooting

### WASM Loading Issues

If you encounter WASM loading errors:

```javascript
// In your vite.config.js, ensure WASM files are properly handled
export default {
  assetsInclude: ['**/*.wasm'],
  build: {
    rollupOptions: {
      external: ['**/*.wasm']
    }
  }
}
```

### Performance Issues

For better performance:
- Reduce light count in scenes
- Disable light markers on high light count scenes
- Increase LOD bias value
- Use Chrome/Firefox with hardware acceleration

### Models Not Loading

Ensure your models are in the correct format:
- Use `.glb` format (binary glTF)
- Check file paths in scene setup
- Verify files exist in `public/assets/models/`

## 🤝 Contributing

Found an issue or want to add a new scene?

1. Fork the repository
2. Create a feature branch
3. Add your changes
4. Submit a pull request

## 📄 License

This example is provided under the same MIT license as the main library.

## 🔗 Links

- **Live Demo**: [three-cluster-lights.netlify.app](https://three-cluster-lights.netlify.app)
- **Documentation**: [Storybook](https://jeffreycastellano.github.io/three-cluster-lights/)
- **NPM Package**: [three-cluster-lights](https://www.npmjs.com/package/three-cluster-lights)
- **GitHub**: [Repository](https://github.com/jeffreycastellano/three-cluster-lights)

