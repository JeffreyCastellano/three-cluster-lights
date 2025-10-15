# WASM Build Migration Guide

This document explains the migration of WASM build scripts from the root project to the `lib/` folder.

## What Changed

### Before

WASM build scripts were defined in the **root** `package.json`:

```bash
# From root directory
npm run build:wasm          # Builds lib/wasm/cluster-lights.wasm
npm run build:wasm-simd     # Builds lib/wasm/cluster-lights-simd.wasm
npm run build:wasm:all      # Builds both + copies to public/
```

### After

WASM build scripts are now in **both** locations:

1. **`lib/package.json`** (primary) - For library development and publishing
2. **Root `package.json`** (delegates) - For project development convenience

## Usage

### For Library Development

Work directly in the `lib/` folder:

```bash
cd lib/

# Build individual versions
npm run build:wasm          # Standard WASM
npm run build:wasm-simd     # SIMD-optimized WASM
npm run build:asm           # ASM.js fallback

# Build all versions
npm run build:all           # Builds all three variants
```

### For Project Development

Use root-level scripts (they delegate to `lib/`):

```bash
# From project root
npm run build:wasm          # Runs: cd lib && npm run build:wasm
npm run build:wasm-simd     # Runs: cd lib && npm run build:wasm-simd
npm run build:wasm:all      # Runs: cd lib && npm run build:all && copies to public/
```

## NPM Publishing

When publishing the library to NPM, WASM modules are automatically rebuilt:

```bash
cd lib/
npm publish
```

The `prepublishOnly` hook in `lib/package.json` ensures all WASM variants are built before publishing.

## Build Output Locations

All builds output to the same location:

- `lib/wasm/cluster-lights.wasm` - Standard version (~47KB)
- `lib/wasm/cluster-lights-simd.wasm` - SIMD version (~50KB)  
- `lib/wasm/cluster-lights-asm.js` - ASM.js fallback (~111KB)

For the demo project, `npm run build:wasm:all` also copies the `.wasm` files to `public/` for Vite to serve.

## Benefits of This Structure

### 1. **Self-Contained Library**
The `lib/` folder can now be published to NPM independently with its own build process.

### 2. **Clear Separation**
- `lib/` = NPM package (self-contained)
- Root = Demo/example project

### 3. **Backward Compatible**
Root-level scripts still work the same way, just delegate to `lib/`.

### 4. **Automatic Rebuilds**
The `prepublishOnly` hook ensures WASM is always up-to-date when publishing.

## Requirements

### Emscripten

You need [Emscripten](https://emscripten.org/) installed to build WASM modules:

```bash
# Install emsdk
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

Verify installation:

```bash
emcc --version
```

### Build Flags Explained

#### Standard WASM (`build:wasm`)
- `-O3` - Maximum optimization
- `-flto` - Link-time optimization
- `--no-entry` - No main function (library mode)
- `-s STANDALONE_WASM` - Create standalone WASM file
- `-s ALLOW_MEMORY_GROWTH=1` - Allow dynamic memory expansion
- `-s INITIAL_MEMORY=48MB` - Start with 48MB
- `-s MAXIMUM_MEMORY=128MB` - Cap at 128MB

#### SIMD WASM (`build:wasm-simd`)
All standard flags plus:
- `-msimd128` - Enable 128-bit SIMD instructions
- `-msse -msse2 -msse3 -msse4.1` - SSE optimizations
- `--closure 1` - Google Closure Compiler (aggressive minification)
- `-s AGGRESSIVE_VARIABLE_ELIMINATION=1` - Remove unused variables
- `-s DISABLE_EXCEPTION_CATCHING=1` - No exception handling (smaller size)
- `-fno-rtti -fno-exceptions` - Disable C++ features

#### ASM.js (`build:asm`)
- `-O2` - Medium optimization (faster compilation than -O3)
- `-s WASM=0` - Output JavaScript instead of WebAssembly
- `-s MODULARIZE=1` - Export as ES module
- `-s EXPORT_NAME='Module'` - Module export name
- `-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap']` - Expose helper functions

## File Sizes

Typical output sizes:

| File | Size | Compression |
|------|------|-------------|
| `cluster-lights.wasm` | ~47KB | Brotli: ~25KB |
| `cluster-lights-simd.wasm` | ~50KB | Brotli: ~27KB |
| `cluster-lights-asm.js` | ~111KB | Brotli: ~35KB |

The SIMD version is slightly larger but runs ~2-3x faster on supported hardware.

## Troubleshooting

### "emcc: command not found"

Install Emscripten (see Requirements above).

### Memory errors during runtime

Increase `MAXIMUM_MEMORY` in the build script:

```javascript
"build:wasm": "emcc ... -s MAXIMUM_MEMORY=256MB ..."
```

### SIMD not working

Check browser support:

```javascript
const simdSupported = await WebAssembly.validate(
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 9, 1, 7, 0, 65, 0, 253, 15, 26, 11])
);
```

The library automatically falls back to standard WASM or ASM.js if SIMD is not available.

## Migration Checklist

- [x] Move build scripts to `lib/package.json`
- [x] Update root `package.json` to delegate
- [x] Add WASM exports to `lib/package.json` exports map
- [x] Add `prepublishOnly` hook for automatic rebuilds
- [x] Document build process in `lib/README.md`
- [x] Test builds from both root and lib directories
- [x] Verify WASM files are included in NPM package

## Next Steps

1. **Test the build**: Run `npm run build:all` from `lib/` to verify everything works
2. **Update CI/CD**: If you have automated builds, update them to use the new scripts
3. **Publish**: When ready, publish the library with `cd lib && npm publish`

