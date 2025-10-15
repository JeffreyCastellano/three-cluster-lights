// performance-metrics.js - GPU timing queries and FPS tracking
//
// Performance stats structure:
// - FPS (with min/max range)
// - CPU / GPU / MEM
// - WASM / CLUSTER / RENDER
//
// Metrics breakdown:
// - FPS: Frames per second with min/max statistics
// - CPU: Total CPU frame time (JavaScript + WASM + overhead)
// - GPU: Total GPU time (CLUSTER + RENDER combined)
// - MEM: JavaScript heap memory usage (auto-switches MB/GB)
// - WASM: CPU time for light updates in WebAssembly
// - CLUSTER: GPU time for light clustering textures (which lights affect which screen tiles)
// - RENDER: GPU time for the entire scene rendering (all geometry with clustered lighting applied)

/**
 * Simple inverse lerp function (avoids Three.js dependency for better Firefox compatibility)
 */
function inverseLerp(min, max, value) {
  if (min === max) return 0;
  return (value - min) / (max - min);
}

/**
 * GPUQuery class for GPU timing using EXT_disjoint_timer_query_webgl2
 * Tracks elapsed time for specific GPU operations (e.g., assign, shade)
 */
export class GPUQuery {
    constructor(renderer, selector) {
        this.el = document.querySelector(selector);
        this.value = 0;
        this.count = 0;
        this.time = 0;

        if (!this.el) {
            console.warn(`[GPUQuery] Element not found for selector: ${selector}`);
            return;
        }

        // Get WebGL context
        this.gl = renderer.getContext();

        // Get timer query extension
        this.ext = this.gl.getExtension("EXT_disjoint_timer_query_webgl2");

        if (!this.ext) {
            console.warn(`[GPUQuery] GPU timing not available for ${selector} - extension not supported`);
            if (this.el) this.el.innerText = "--";
            this.gl = null;
            return;
        }

        this.query = this.gl.createQuery();
        this.waiting = false;
        this.queryActive = false; // Track if beginQuery was called
    }

    start() {
        if (!this.gl) return;
        if (!this.waiting && !this.queryActive) {
            this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query);
            this.queryActive = true;
        }
    }

    end(time) {
        if (!this.gl) return;
        // Only call endQuery if we actually started a query
        if (!this.waiting && this.queryActive) {
            this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
            this.waiting = true;
            this.queryActive = false;
        }

        // Only check query results if we're actually waiting for one
        if (this.waiting) {
            const available = this.gl.getQueryParameter(this.query, this.gl.QUERY_RESULT_AVAILABLE);
            const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);

            if (available && !disjoint) {
                let timeElapsed = this.gl.getQueryParameter(this.query, this.gl.QUERY_RESULT);
                this.value += timeElapsed / 1000000; // Convert to milliseconds
                this.count++;
                this.waiting = false; // Ready for next query
            }
        }

        // Update display every 2 seconds
        if (time - this.time > 2) {
            this.time = time;
            if (this.el && this.count > 0) {
                this.el.innerText = (this.value / this.count).toFixed(2);
            }
            this.count = 0;
            this.value = 0;
        }
    }

    dispose() {
        if (this.query && this.gl) {
            this.gl.deleteQuery(this.query);
            this.query = null;
        }
        this.gl = null;
        this.ext = null;
        this.el = null;
    }
}

/**
 * FPSMeter class for tracking frames per second with min/max statistics
 */
export class FPSMeter {
    constructor(selector, minSelector, maxSelector) {
        this.el = document.querySelector(selector);
        this.minEl = document.querySelector(minSelector);
        this.maxEl = document.querySelector(maxSelector);

        this.min = 0;
        this.max = 0;
        this.value = 0;
        this.count = 0;
        this.nextTime = 0;
        this.prevTime = 0;
    }

    update(time) {
        if (this.prevTime === 0) this.prevTime = time;
        if (this.nextTime === 0) this.nextTime = time + 2;

        const dt = time - this.prevTime;
        this.prevTime = time;

        if (time > this.nextTime) {
            this.nextTime = time + 2;
            const v = parseInt(1 / (this.value / this.count));

            if (this.el) this.el.innerText = v;

            this.min = this.min === 0 ? v : Math.min(this.min, v);
            this.max = this.max === 0 ? v : Math.max(this.max, v);

            if (this.minEl) this.minEl.innerText = this.min;
            if (this.maxEl) this.maxEl.innerText = this.max;

            // Color code FPS based on min/max range
            if (this.el) {
                const pc = parseInt(100 * inverseLerp(this.min, this.max, v));
                this.el.style.color = `hsl(${pc}deg 100% 60%)`;
            }

            this.count = 0;
            this.value = 0;
        }

        this.value += dt;
        this.count++;
    }
}

/**
 * CPUTimer class for tracking CPU frame time
 */
export class CPUTimer {
    constructor(selector) {
        this.el = document.querySelector(selector);
        this.value = 0;
        this.count = 0;
        this.time = 0;
        this.nextTime = 0;
        this.startTime = 0;
    }

    begin() {
        this.startTime = performance.now();
    }

    end(time) {
        const elapsed = performance.now() - this.startTime;
        this.value += elapsed;
        this.count++;

        // Update display every 2 seconds
        if (time - this.time > 2) {
            this.time = time;
            if (this.el && this.count > 0) {
                this.el.innerText = (this.value / this.count).toFixed(2);
            }
            this.count = 0;
            this.value = 0;
        }
    }
}

/**
 * MemoryMonitor class for tracking heap memory usage
 */
export class MemoryMonitor {
    constructor(selector, unitSelector) {
        this.el = document.querySelector(selector);
        this.unitEl = document.querySelector(unitSelector);
        this.time = 0;

        // Check if memory API is available
        this.hasMemory = performance.memory !== undefined;

        if (!this.hasMemory && this.el) {
            this.el.innerText = "--";
            console.warn('[MemoryMonitor] performance.memory not available');
        }
    }

    update(time) {
        if (!this.hasMemory) return;

        // Update display every 2 seconds
        if (time - this.time > 2) {
            this.time = time;
            if (this.el) {
                const memMB = performance.memory.usedJSHeapSize / 1048576; // Convert to MB

                // Display in GB if over 1024 MB
                if (memMB >= 1024) {
                    const memGB = memMB / 1024;
                    this.el.innerText = memGB.toFixed(2);
                    if (this.unitEl) this.unitEl.innerText = 'GB';
                } else {
                    this.el.innerText = memMB.toFixed(1);
                    if (this.unitEl) this.unitEl.innerText = 'MB';
                }
            }
        }
    }
}
