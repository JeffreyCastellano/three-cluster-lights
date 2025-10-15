// adaptive-tile-span.js - Dynamic performance tuning for tile overdraw
// Automatically adjusts maxTileSpan based on framerate to maintain target FPS

export class AdaptiveTileSpan {
  constructor(lightsSystem, options = {}) {
    this.lightsSystem = lightsSystem;
    
    // Configuration
    this.targetFPS = options.targetFPS || 90;
    this.minTileSpan = options.minTileSpan || 6;   // Don't go below this (prevent tile boundary artifacts)
    this.maxTileSpan = options.maxTileSpan || 16;  // Don't go above this (preserve performance)
    this.enabled = options.enabled ?? true;
    
    // FPS tracking
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.currentFPS = 60;
    this.fpsHistory = [];
    this.fpsHistorySize = 10; // Average over last 10 samples
    
    // Adjustment parameters
    this.adjustmentRate = options.adjustmentRate || 0.5; // How aggressively to adjust (0-1)
    this.updateInterval = options.updateInterval || 500; // Update every 500ms
    this.lastAdjustmentTime = 0;
    
    // Thresholds for adjustments
    this.fpsMarginLow = options.fpsMarginLow || 0.9;   // 90% of target = reduce quality
    this.fpsMarginHigh = options.fpsMarginHigh || 1.1; // 110% of target = increase quality
  }
  
  update(deltaTime) {
    if (!this.enabled) return;
    
    // Calculate FPS
    this.frameCount++;
    const currentTime = performance.now();
    const elapsed = currentTime - this.lastTime;
    
    if (elapsed >= 100) { // Update FPS every 100ms
      this.currentFPS = (this.frameCount / elapsed) * 1000;
      this.frameCount = 0;
      this.lastTime = currentTime;
      
      // Add to history for smoothing
      this.fpsHistory.push(this.currentFPS);
      if (this.fpsHistory.length > this.fpsHistorySize) {
        this.fpsHistory.shift();
      }
    }
    
    // Only adjust periodically
    if (currentTime - this.lastAdjustmentTime < this.updateInterval) {
      return;
    }
    
    this.lastAdjustmentTime = currentTime;
    
    // Calculate smoothed average FPS
    if (this.fpsHistory.length === 0) return;
    const avgFPS = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    
    // Get current tile span
    const currentSpan = this.lightsSystem.getMaxTileSpan();
    
    // Determine if adjustment is needed
    const fpsRatio = avgFPS / this.targetFPS;
    let newSpan = currentSpan;
    
    if (fpsRatio < this.fpsMarginLow) {
      // FPS too low - reduce tile span for better performance
      const adjustment = Math.ceil(this.adjustmentRate * 2); // Reduce by 1-2 tiles
      newSpan = Math.max(this.minTileSpan, currentSpan - adjustment);
      
      if (newSpan !== currentSpan) {
        this.lightsSystem.setMaxTileSpan(newSpan);
      }
      
    } else if (fpsRatio > this.fpsMarginHigh) {
      // FPS too high - increase tile span for better quality
      const adjustment = Math.ceil(this.adjustmentRate); // Increase by 0-1 tiles
      newSpan = Math.min(this.maxTileSpan, currentSpan + adjustment);
      
      if (newSpan !== currentSpan) {
        this.lightsSystem.setMaxTileSpan(newSpan);
      }
    }
  }
  
  // Enable/disable adaptive tuning
  setEnabled(enabled) {
    this.enabled = enabled;
  }
  
  // Update target FPS
  setTargetFPS(fps) {
    this.targetFPS = fps;
  }
  
  // Reset FPS history (call when switching scenes)
  reset() {
    this.fpsHistory = [];
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.lastAdjustmentTime = 0;
  }
  
  // Get current statistics
  getStats() {
    const avgFPS = this.fpsHistory.length > 0
      ? this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length
      : this.currentFPS;
    
    return {
      enabled: this.enabled,
      currentFPS: this.currentFPS,
      averageFPS: avgFPS,
      targetFPS: this.targetFPS,
      currentTileSpan: this.lightsSystem.getMaxTileSpan(),
      minTileSpan: this.minTileSpan,
      maxTileSpan: this.maxTileSpan
    };
  }
}

