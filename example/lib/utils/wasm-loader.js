/**
 * Helper function to load the WASM module
 * Automatically detects SIMD support and loads the appropriate version
 * Falls back to JavaScript implementation if WASM is unavailable
 *
 * @param {Object} options - Load options
 * @param {boolean} options.preferSIMD - Prefer SIMD version if available (default: true)
 * @param {string} options.wasmPath - Custom path to WASM file (optional)
 * @param {boolean} options.allowFallback - Allow JavaScript fallback if WASM unavailable (default: true)
 * @returns {Promise<WebAssembly.Instance>} The loaded WASM instance or fallback
 *
 * @example
 * import { loadWasm } from 'wasm-three-lights/lib/loadWasm.js';
 *
 * const wasm = await loadWasm();
 * // or with custom path
 * const wasm = await loadWasm({
 *   wasmPath: '/custom/path/cluster-lights-simd.wasm'
 * });
 *
 * // Debug URL parameters (for testing):
 * // ?wasm=fallback - Force JavaScript fallback
 * // ?wasm=simd     - Force SIMD version (may fail if unsupported)
 * // ?wasm=nosimd   - Force non-SIMD version
 */
export async function loadWasm(options = {}) {
  const { allowFallback = true } = options;

  // Check for debug URL parameter to force specific version
  const urlParams = new URLSearchParams(window.location.search);
  const wasmDebug = urlParams.get('wasm');

  // Force ASM.js fallback via URL parameter
  if (wasmDebug === 'fallback') {
    console.warn('[WASM] Debug mode: forcing ASM.js fallback (URL param: ?wasm=fallback)');
    // Load ASM.js as a script (it's not an ES module)
    const asmUrl = new URL('../wasm/cluster-lights-asm.js', import.meta.url).href;

    // Wait for Module to be ready
    const Module = await new Promise((resolve, reject) => {
      window.Module = {
        onRuntimeInitialized: function() {
          resolve(this);
        }
      };
      const script = document.createElement('script');
      script.src = asmUrl;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    // Emscripten Module structure is different - wrap it to match WASM instance API
    // Emscripten adds _ prefix to C functions, so we need to create aliases
    const exports = new Proxy(Module, {
      get(target, prop) {
        // Try the property as-is first
        if (prop in target) return target[prop];
        // Try with underscore prefix (Emscripten convention)
        const underscoreProp = '_' + prop;
        if (underscoreProp in target) return target[underscoreProp];
        // Special case for memory
        if (prop === 'memory') return { buffer: target.HEAP8.buffer };
        return undefined;
      }
    });

    return {
      instance: {
        exports,
        memory: { buffer: Module.HEAP8.buffer }
      }
    };
  }

  // Check if WebAssembly is available at all (might be blocked by CSP or corporate policy)
  if (typeof WebAssembly === 'undefined') {
    if (allowFallback) {
      console.warn(
        '[WASM] WebAssembly is not supported or blocked. ' +
        'Falling back to ASM.js implementation (slower, max ~8k lights recommended). ' +
        'For production, enable WASM via Content Security Policy: script-src \'wasm-unsafe-eval\''
      );
      const asmUrl = new URL('../wasm/cluster-lights-asm.js', import.meta.url).href;
      const Module = await new Promise((resolve, reject) => {
        window.Module = {
          onRuntimeInitialized: function() {
            resolve(this);
          }
        };
        const script = document.createElement('script');
        script.src = asmUrl;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      const exports = new Proxy(Module, {
        get(target, prop) {
          if (prop in target) return target[prop];
          const underscoreProp = '_' + prop;
          if (underscoreProp in target) return target[underscoreProp];
          if (prop === 'memory') return { buffer: target.HEAP8.buffer };
          return undefined;
        }
      });
      return {
        instance: {
          exports,
          memory: { buffer: Module.HEAP8.buffer }
        }
      };
    }

    throw new Error(
      'WebAssembly is not supported or blocked in this environment. ' +
      'This library requires WebAssembly to function. ' +
      'If you are in a corporate environment, check Content Security Policy (CSP) headers.'
    );
  }
  const {
    preferSIMD = true,
    wasmPath = null
  } = options;

  // Determine WASM file to load
  let wasmUrl;
  let forcedVersion = null;

  if (wasmPath) {
    // User provided custom path
    wasmUrl = wasmPath;
  } else {
    // Check for forced WASM version via URL parameter
    let useSIMD;

    if (wasmDebug === 'simd') {
      console.warn('[WASM] Debug mode: forcing SIMD version (URL param: ?wasm=simd)');
      useSIMD = true;
      forcedVersion = 'SIMD';
    } else if (wasmDebug === 'nosimd') {
      console.warn('[WASM] Debug mode: forcing non-SIMD version (URL param: ?wasm=nosimd)');
      useSIMD = false;
      forcedVersion = 'non-SIMD';
    } else {
      // Auto-detect: use SIMD if preferred and supported
      useSIMD = preferSIMD && await checkSIMDSupport();
    }

    const filename = useSIMD ? 'cluster-lights-simd.wasm' : 'cluster-lights.wasm';

    // Try to resolve from package
    try {
      // This works with bundlers that support import.meta.url
      // wasm-loader.js is in lib/utils/, so ../wasm/ goes up to lib/ then into wasm/
      wasmUrl = new URL(`../wasm/${filename}`, import.meta.url).href;
    } catch (e) {
      // Fallback for environments without import.meta.url
      wasmUrl = `/lib/wasm/${filename}`;
    }
  }

  // Load WASM
  try {
    // Try streaming first (requires correct MIME type: application/wasm)
    const wasmModule = await WebAssembly.instantiateStreaming(
      fetch(wasmUrl),
      {
        env: {
          emscripten_notify_memory_growth: () => {}
        }
      }
    );

    // Log which version was loaded
    if (forcedVersion) {
      console.info(`[WASM] Loaded ${forcedVersion} version (forced via URL param)`);
    }

    return wasmModule;
  } catch (streamError) {
    // Fallback: fetch as ArrayBuffer (works even with incorrect MIME type)
    console.warn(`[WASM] Streaming failed, trying ArrayBuffer fallback:`, streamError.message);
    try {
      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const wasmBytes = await response.arrayBuffer();
      const wasmModule = await WebAssembly.instantiate(wasmBytes, {
        env: {
          emscripten_notify_memory_growth: () => {}
        }
      });

      // Log which version was loaded
      if (forcedVersion) {
        console.info(`[WASM] Loaded ${forcedVersion} version via ArrayBuffer (forced via URL param)`);
      }
      return wasmModule;
    } catch (error) {
      // If fallback is allowed, use ASM.js implementation
      if (allowFallback) {
        console.warn(
          `[WASM] Failed to load WASM from ${wasmUrl}: ${error.message}. ` +
          'Falling back to ASM.js implementation (slower, max ~8k lights recommended).'
        );
        const asmUrl = new URL('../wasm/cluster-lights-asm.js', import.meta.url).href;
        const Module = await new Promise((resolve, reject) => {
          window.Module = {
            onRuntimeInitialized: function() {
              resolve(this);
            }
          };
          const script = document.createElement('script');
          script.src = asmUrl;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        const exports = new Proxy(Module, {
          get(target, prop) {
            if (prop in target) return target[prop];
            const underscoreProp = '_' + prop;
            if (underscoreProp in target) return target[underscoreProp];
            if (prop === 'memory') return { buffer: target.HEAP8.buffer };
            return undefined;
          }
        });
        return {
          instance: {
            exports,
            memory: { buffer: Module.HEAP8.buffer }
          }
        };
      }

      throw new Error(`Failed to load WASM from ${wasmUrl}: ${error.message}`);
    }
  }
}

/**
 * Check if the browser supports WASM SIMD
 * @returns {Promise<boolean>}
 */
async function checkSIMDSupport() {
  try {
    // Properly formatted WASM module with SIMD instruction
    // This is the standard test used by major projects
    const simdTest = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic (\0asm)
      0x01, 0x00, 0x00, 0x00, // version 1
      0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section: function with no params/returns
      0x03, 0x02, 0x01, 0x00, // function section: 1 function, type 0
      0x0a, 0x09, 0x01, 0x07, 0x00, // code section: 1 function body
      0x41, 0x00, // i32.const 0
      0xfd, 0x0f, // i8x16.splat
      0x1a, // drop
      0x0b  // end
    ]);

    const isValid = WebAssembly.validate(simdTest);
    return isValid;
  } catch (e) {
    console.warn(`[WASM] SIMD support check failed with error:`, e.message);
    return false;
  }
}
