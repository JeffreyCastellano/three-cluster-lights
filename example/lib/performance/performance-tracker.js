/**
 * PerformanceTracker - Complete performance monitoring solution
 * Handles HTML injection, CSS styling, and all tracking logic
 *
 * @example
 * import { PerformanceTracker } from 'three-cluster-lights';
 *
 * const tracker = new PerformanceTracker(renderer);
 *
 * // In render loop:
 * tracker.begin();
 * // ... rendering ...
 * tracker.end();
 */

import { FPSMeter, CPUTimer, MemoryMonitor, GPUQuery } from './performance-metrics.js';

export class PerformanceTracker {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.options = {
      container: document.body,
      showFPS: true,
      showCPU: true,
      showGPU: true,
      showMemory: true,
      showWASM: true,
      showCluster: true,
      showRender: true,
      ...options
    };

    this.trackers = {};
    this.clock = { startTime: performance.now() };
    this.element = null;
    this.styleElement = null;

    // Detect feature support
    this._detectFeatureSupport();

    // Initialize
    this._injectCSS();
    this._injectHTML();
    this._createTrackers();
  }

  /**
   * Detect which features are supported on this device
   * @private
   */
  _detectFeatureSupport() {
    // Check GPU timing support
    const gl = this.renderer.getContext();
    const hasGPUTiming = gl.getExtension("EXT_disjoint_timer_query_webgl2") !== null;

    if (!hasGPUTiming) {
      console.warn('[PerformanceTracker] GPU timing not supported - hiding GPU metrics');
      this.options.showGPU = false;
      this.options.showCluster = false;
      this.options.showRender = false;
    }

    // Check memory API support
    const hasMemory = performance.memory !== undefined;

    if (!hasMemory) {
      console.warn('[PerformanceTracker] Memory API not supported - hiding memory metrics');
      this.options.showMemory = false;
    }
  }

  /**
   * Inject the performance tracker CSS into the page
   * @private
   */
  _injectCSS() {
    // Check if CSS is already injected
    if (document.getElementById('perf-tracker-styles')) {
      return;
    }

    const css = `
      #perf-stats {
        position: absolute;
        left: 22px;
        top: 18px;
        background-color: #0D1117;
        border: 1px solid rgba(255, 255, 255, 0.08);
        padding: 12px 14px;
        border-radius: 8px;
        user-select: none;
        -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        line-height: 1.4;
        min-width: 150px;
        z-index: 1000;
      }

      #perf-stats .stat-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
        gap: 12px;
        color:rgb(148, 154, 160);
      }

      #perf-stats .stat-row:last-child {
        margin-bottom: 0;
      }

      #perf-stats .stat-row.separator {
        height: 1px;
        background: rgba(255, 255, 255, 0.08);
        margin: 10px 0;
      }

      #perf-stats .stat-label {
        font-weight: 700;
        letter-spacing: 0.05 em;
        text-transform: uppercase;
        font-size: 10px;
        flex-shrink: 0;
      }

      #perf-stats .stat-label .unit {
        font-size: 7.5px;
        opacity: 0.75;
        color:rgb(172, 208, 240);
        padding-left: 2px;
        font-weight: 600;
         letter-spacing:0px;
      }

      #perf-stats .stat-value {
        font-weight: 500;
        font-size: 10px;
        letter-spacing: 0.025 em;
        font-variant-numeric: tabular-nums;
        text-align: right;
      }

      #perf-stats .stat-fps {
        margin-bottom: 0;
      }

      #perf-stats .stat-fps .fps-range {
        font-size: 10px;
        opacity: 0.4;
        margin-right: 3px;
        letter-spacing: 0px;
        font-weight: 400;
      }

      .stat-row.cpu .stat-value {
        color: hsl(30deg 70% 60%);
      }

      .stat-row.gpu .stat-value {
        color: hsl(120deg 70% 60%);
      }

      .stat-row.mem .stat-value {
        color: hsl(60deg 70% 60%);
      }

      .stat-row.wasm .stat-value {
        color: hsl(90deg 70% 60%);
      }

      .stat-row.cluster .stat-value {
        color: hsl(180deg 70% 60%);
      }

      .stat-row.render .stat-value {
        color: hsl(270deg 70% 60%);
      }

      .stat-row.lights .stat-value {
        color: hsl(200deg 70% 60%);
      }
    `;

    this.styleElement = document.createElement('style');
    this.styleElement.id = 'perf-tracker-styles';
    this.styleElement.textContent = css;
    document.head.appendChild(this.styleElement);
  }

  /**
   * Inject the performance tracker HTML into the page
   * @private
   */
  _injectHTML() {
    const { showFPS, showCPU, showGPU, showMemory, showWASM, showCluster, showRender } = this.options;

    const html = `
      <div id="perf-stats">
        ${showFPS ? `
          <div class="stat-row stat-fps">
            <span class="stat-label">FPS <span class="unit"><span id="minFps">--</span>-<span id="maxFps">--</span></span></span>
            <span class="stat-value"><span id="fps">--</span></span>
          </div>
          <div class="stat-row separator"></div>
        ` : ''}

        ${showCPU ? `
          <div class="stat-row cpu">
            <span class="stat-label">CPU <span class="unit">MS</span></span>
            <span class="stat-value"><span id="perf-cpu-value">--</span></span>
          </div>
        ` : ''}

        ${showGPU ? `
          <div class="stat-row gpu">
            <span class="stat-label">GPU <span class="unit">MS</span></span>
            <span class="stat-value"><span id="perf-gpu-value">--</span></span>
          </div>
        ` : ''}

        ${showMemory ? `
          <div class="stat-row mem">
            <span class="stat-label">MEM <span class="unit"><span id="perf-mem-unit">MB</span></span></span>
            <span class="stat-value"><span id="perf-mem-value">--</span></span>
          </div>
        ` : ''}

        ${(showWASM || showCluster || showRender) ? '<div class="stat-row separator"></div>' : ''}

        ${showWASM ? `
          <div class="stat-row wasm">
            <span class="stat-label">WASM <span class="unit">MS</span></span>
            <span class="stat-value"><span id="perf-wasm-value">--</span></span>
          </div>
        ` : ''}

        ${showCluster ? `
          <div class="stat-row cluster">
            <span class="stat-label">CULL <span class="unit">MS</span></span>
            <span class="stat-value"><span id="perf-assign-value">--</span></span>
          </div>
        ` : ''}

        ${showRender ? `
          <div class="stat-row render">
            <span class="stat-label">RENDER <span class="unit">MS</span></span>
            <span class="stat-value"><span id="perf-shade-value">--</span></span>
          </div>
        ` : ''}

        <div class="stat-row separator"></div>

        <div class="stat-row lights">
          <span class="stat-label">LIGHTS <span class="unit">NUM</span></span>
          <span class="stat-value"><span id="perf-lights-value">--</span></span>
        </div>
      </div>
    `;

    this.options.container.insertAdjacentHTML('beforeend', html);
    this.element = document.getElementById('perf-stats');
  }

  /**
   * Create tracker instances
   * @private
   */
  _createTrackers() {
    const { showFPS, showCPU, showMemory, showCluster, showRender } = this.options;

    if (showFPS) {
      this.trackers.fps = new FPSMeter("#fps", "#minFps", "#maxFps");
    }

    if (showCPU) {
      this.trackers.cpu = new CPUTimer("#perf-cpu-value");
    }

    if (showMemory) {
      this.trackers.memory = new MemoryMonitor("#perf-mem-value", "#perf-mem-unit");
    }

    if (showCluster) {
      this.trackers.cluster = new GPUQuery(this.renderer, "#perf-assign-value");
    }

    if (showRender) {
      this.trackers.render = new GPUQuery(this.renderer, "#perf-shade-value");
    }
  }

  /**
   * Call at the beginning of your render loop
   */
  begin() {
    if (this.trackers.cpu) {
      this.trackers.cpu.begin();
    }
  }

  /**
   * Call at the end of your render loop
   * Automatically updates all trackers
   */
  end() {
    const time = (performance.now() - this.clock.startTime) / 1000;

    if (this.trackers.cpu) {
      this.trackers.cpu.end(time);
    }

    if (this.trackers.fps) {
      this.trackers.fps.update(time);
    }

    if (this.trackers.memory) {
      this.trackers.memory.update(time);
    }

    if (this.trackers.cluster) {
      this.trackers.cluster.end(time);
    }

    if (this.trackers.render) {
      this.trackers.render.end(time);
    }

    // Update GPU total
    this._updateGPUTotal();
  }

  /**
   * Start GPU timing for cluster pass
   */
  beginCluster() {
    if (this.trackers.cluster) {
      this.trackers.cluster.start();
    }
  }

  /**
   * End GPU timing for cluster pass
   */
  endCluster() {
    const time = (performance.now() - this.clock.startTime) / 1000;
    if (this.trackers.cluster) {
      this.trackers.cluster.end(time);
    }
  }

  /**
   * Start GPU timing for render pass
   */
  beginRender() {
    if (this.trackers.render) {
      this.trackers.render.start();
    }
  }

  /**
   * End GPU timing for render pass
   */
  endRender() {
    const time = (performance.now() - this.clock.startTime) / 1000;
    if (this.trackers.render) {
      this.trackers.render.end(time);
    }
  }

  /**
   * Update GPU total (sum of cluster + render)
   * @private
   */
  _updateGPUTotal() {
    // Skip if GPU metrics aren't shown or supported
    if (!this.options.showGPU) return;

    const gpuEl = document.querySelector("#perf-gpu-value");
    const assignEl = document.querySelector("#perf-assign-value");
    const shadeEl = document.querySelector("#perf-shade-value");

    // Only update if all elements exist
    if (gpuEl && assignEl && shadeEl) {
      const assignValue = parseFloat(assignEl.innerText) || 0;
      const shadeValue = parseFloat(shadeEl.innerText) || 0;
      const total = assignValue + shadeValue;

      if (total > 0) {
        gpuEl.innerText = total.toFixed(2);
      }
    }
  }

  /**
   * Set WASM timing value (called by LightsSystem)
   * @param {number} ms - Time in milliseconds
   */
  setWASMTime(ms) {
    const wasmEl = document.querySelector("#perf-wasm-value");
    if (wasmEl) {
      wasmEl.innerText = ms.toFixed(2);
    }
  }

  /**
   * Remove the performance tracker from the page
   */
  dispose() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
    this.trackers = {};
  }

  /**
   * Get individual tracker instances (for advanced usage)
   */
  getTrackers() {
    return this.trackers;
  }
}
