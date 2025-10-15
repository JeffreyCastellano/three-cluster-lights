// light-markers.js - Three.js visual markers for clustered lights
import { ShaderMaterial, AdditiveBlending, DoubleSide, PlaneGeometry, Mesh, Group, Vector3 } from 'three';

export class LightMarkers {
  constructor(lightsSystem, options = {}) {
    this.lightsSystem = lightsSystem;
    this.visible = options.visible !== undefined ? options.visible : true;
    this.showGlow = options.showGlow !== undefined ? options.showGlow : true;
    this.pointGlowRadius = options.pointGlowRadius !== undefined ? options.pointGlowRadius : 0.5;
    this.spotGlowRadius = options.spotGlowRadius !== undefined ? options.spotGlowRadius : 0.5;
    this.rectGlowRadius = options.rectGlowRadius !== undefined ? options.rectGlowRadius : 0.5;
    this.glowRadius = options.glowRadius !== undefined ? options.glowRadius : 0.5;
    this.colorOverride = options.colorOverride || new Vector3(-1, -1, -1);
    this.markerScale = options.markerScale !== undefined ? options.markerScale : 0.12;

    this.meshes = {};
    this.materials = {};
    this.geometries = {};
    this.group = new Group();
  }

  createPointLightMaterial() {
    return new ShaderMaterial({
      transparent: true,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        lightTexture: { value: null },
        lightTextureWidth: { value: 2048 },
        showGlow: { value: this.showGlow },
        glowRadius: { value: this.pointGlowRadius },
        colorOverride: { value: this.colorOverride },
        markerScale: { value: this.markerScale }
      },
      vertexShader: `
        uniform sampler2D lightTexture;
        uniform int lightTextureWidth;
        uniform float markerScale;
        varying vec4 vColor;
        varying vec3 vPosition;
        varying float vVisibility;
        varying float vLOD;

        void main() {
          float lightIdx = float(gl_InstanceID);
          float baseTexel = lightIdx * 2.0;
          float width = float(lightTextureWidth);
          int row = int(floor(baseTexel / width));
          int col = int(baseTexel - float(row) * width);
          ivec2 posCoord = ivec2(col, row);

          float nextTexel = baseTexel + 1.0;
          int nextRow = int(floor(nextTexel / width));
          int nextCol = int(nextTexel - float(nextRow) * width);
          ivec2 colorCoord = ivec2(nextCol, nextRow);

          vec4 posRadius = texelFetch(lightTexture, posCoord, 0);
          vec4 colorDecayVisible = texelFetch(lightTexture, colorCoord, 0);

          float packedValue = colorDecayVisible.w;
          float decay = floor(packedValue * 0.01) * 0.1;
          float visible = mod(floor(packedValue * 0.1), 2.0);
          float lod = mod(packedValue, 10.0);

          vColor = vec4(colorDecayVisible.rgb, -posRadius.z);
          vPosition = position.xyz;
          vVisibility = visible;
          vLOD = lod;

          float lodScale = 1.0;
          if (lod < 1.5) lodScale = 0.5;
          else if (lod < 2.5) lodScale = 0.75;

          float scale = posRadius.w * markerScale * lodScale;
          vec3 transformedPosition = position.xyz * scale;

          // posRadius.xyz is already in view space
          gl_Position = projectionMatrix * vec4(transformedPosition + posRadius.xyz, 1.);
        }
      `,
      fragmentShader: `
        uniform bool showGlow;
        uniform float glowRadius;
        uniform vec3 colorOverride;
        varying vec4 vColor;
        varying vec3 vPosition;
        varying float vVisibility;
        varying float vLOD;

        void main() {
          if (vVisibility < 0.5 || vLOD < 0.5) discard;

          vec3 color = colorOverride.x < 0.0 ? vColor.rgb : colorOverride;

          float lodIntensity = 1.0;
          if (vLOD < 1.5) {
            lodIntensity = 0.3;
          } else if (vLOD < 2.5) {
            lodIntensity = 0.6;
          }

          float len = min(glowRadius, length(vPosition.xy));
          float mv = 1. - max(0., min(1., vColor.a / 64.));
          float a = smoothstep(mix(0.0, 0.1, mv), 0.11, len);
          float b = smoothstep(glowRadius, 0.09, len);
          gl_FragColor.rgb = mix(glowRadius, 1., mv) * mix(vec3(lodIntensity), color * pow(b, 6.) * lodIntensity, max(0., max(0.1, a * a)));
          gl_FragColor.a = 0.;
        }
      `
    });
  }

  createSpotLightMaterial() {
    return new ShaderMaterial({
      transparent: true,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        lightTexture: { value: null },
        showGlow: { value: this.showGlow },
        glowRadius: { value: this.spotGlowRadius },
        colorOverride: { value: this.colorOverride }
      },
      vertexShader: `
        uniform sampler2D lightTexture;
        varying vec4 vColor;
        varying vec3 vPosition;
        varying vec2 vAngle;
        varying float vVisibility;
        varying float vLOD;

        void main() {
          int lightIndex = gl_InstanceID * 4;
          vec4 posRadius = texelFetch(lightTexture, ivec2(lightIndex, 0), 0);
          vec4 colorIntensity = texelFetch(lightTexture, ivec2(lightIndex + 1, 0), 0);
          vec4 angleParams = texelFetch(lightTexture, ivec2(lightIndex + 3, 0), 0);

          float packedValue = angleParams.w;
          float visible = floor(packedValue * 0.1);
          float lod = mod(packedValue, 10.0);

          vColor = vec4(colorIntensity.rgb, -posRadius.z);
          vPosition = position.xyz;
          vAngle = angleParams.xy;
          vVisibility = visible;
          vLOD = lod;

          float lodScale = lod < 1.5 ? 0.5 : (lod < 2.5 ? 0.75 : 1.0);
          float scale = posRadius.w * 0.08 * lodScale;
          vec3 transformedPosition = position.xyz * scale;

          gl_Position = projectionMatrix * vec4(transformedPosition + posRadius.xyz, 1.);
        }
      `,
      fragmentShader: `
        uniform bool showGlow;
        uniform float glowRadius;
        uniform vec3 colorOverride;
        varying vec4 vColor;
        varying vec3 vPosition;
        varying vec2 vAngle;
        varying float vVisibility;
        varying float vLOD;

        void main() {
          if (vVisibility < 0.5 || vLOD < 0.5) discard;

          vec3 color = colorOverride.x < 0.0 ? vColor.rgb : colorOverride;
          float lodIntensity = vLOD < 1.5 ? 0.3 : (vLOD < 2.5 ? 0.6 : 1.0);

          float len = length(vPosition.xy);
          float core = 1.0 - smoothstep(0.0, 0.2 * glowRadius, len);
          float glow = showGlow ? (1.0 - smoothstep(0.2 * glowRadius, 0.5 * glowRadius, len)) : 0.0;

          float alpha = core + glow * 0.5;
          color = mix(color, vec3(1.0), core * 0.5);

          gl_FragColor = vec4(color * alpha * lodIntensity, alpha * 0.7);
        }
      `
    });
  }

  createRectLightMaterial() {
    return new ShaderMaterial({
      transparent: true,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        lightTexture: { value: null },
        showGlow: { value: this.showGlow },
        glowRadius: { value: this.rectGlowRadius },
        colorOverride: { value: this.colorOverride }
      },
      vertexShader: `
        uniform sampler2D lightTexture;
        varying vec4 vColor;
        varying vec3 vPosition;
        varying vec2 vSize;
        varying float vVisibility;
        varying float vLOD;

        void main() {
          int lightIndex = gl_InstanceID * 4;
          vec4 posRadius = texelFetch(lightTexture, ivec2(lightIndex, 0), 0);
          vec4 colorIntensity = texelFetch(lightTexture, ivec2(lightIndex + 1, 0), 0);
          vec4 sizeParams = texelFetch(lightTexture, ivec2(lightIndex + 2, 0), 0);
          vec4 normal = texelFetch(lightTexture, ivec2(lightIndex + 3, 0), 0);

          float packedValue = sizeParams.w;
          float visible = floor(packedValue * 0.1);
          float lod = mod(packedValue, 10.0);

          vColor = vec4(colorIntensity.rgb, -posRadius.z);
          vPosition = position.xyz;
          vSize = sizeParams.xy;
          vVisibility = visible;
          vLOD = lod;

          vec3 z_axis = normal.xyz;
          mat3 viewMatrix3x3 = mat3(modelViewMatrix);
          vec3 y_axis_ref = normalize(viewMatrix3x3 * vec3(0.0, 1.0, 0.0));

          vec3 x_axis;
          vec3 y_axis;

          if (abs(dot(z_axis, y_axis_ref)) > 0.999) {
            vec3 z_axis_ref = normalize(viewMatrix3x3 * vec3(0.0, 0.0, 1.0));
            x_axis = normalize(cross(z_axis_ref, z_axis));
            y_axis = normalize(cross(z_axis, x_axis));
          } else {
            x_axis = normalize(cross(y_axis_ref, z_axis));
            y_axis = normalize(cross(z_axis, x_axis));
          }

          float lodScale = lod < 1.5 ? 0.5 : 1.0;
          vec3 localPos = vec3(position.x * sizeParams.x * lodScale, position.y * sizeParams.y * lodScale, position.z);
          vec3 transformedPosition = x_axis * localPos.x +
                                    y_axis * localPos.y +
                                    z_axis * localPos.z * 0.1;

          gl_Position = projectionMatrix * vec4(transformedPosition + posRadius.xyz, 1.);
        }
      `,
      fragmentShader: `
        uniform bool showGlow;
        uniform float glowRadius;
        uniform vec3 colorOverride;
        varying vec4 vColor;
        varying vec3 vPosition;
        varying vec2 vSize;
        varying float vVisibility;
        varying float vLOD;

        void main() {
          if (vVisibility < 0.5 || vLOD < 0.5) discard;

          vec3 color = colorOverride.x < 0.0 ? vColor.rgb : colorOverride;
          float lodIntensity = vLOD < 1.5 ? 0.3 : 1.0;

          vec2 uv = abs(vPosition.xy);
          float rect = step(uv.x, 0.45) * step(uv.y, 0.45);
          float edge = 0.0;

          float alpha = rect * 0.9 + edge * 0.3;
          color = mix(color, vec3(1.0), rect * 0.4);

          gl_FragColor = vec4(color * alpha * lodIntensity, alpha * 0.8);
        }
      `
    });
  }

  // Initialize light source meshes (call after lights are added)
  init(scene) {
    // Use WASM counts, not JS array lengths (arrays may be stale)
    const pointCount = this.lightsSystem.wasm.exports.getPointLightCount();
    const spotCount = this.lightsSystem.wasm.exports.getSpotLightCount();
    const rectCount = this.lightsSystem.wasm.exports.getRectLightCount();

    // Add group to scene
    this.group.visible = this.visible;
    scene.add(this.group);

    // Create point light visualization
    if (pointCount > 0) {
      const geometry = new PlaneGeometry(1, 1);
      geometry.isInstancedBufferGeometry = true;
      geometry.instanceCount = pointCount;
      this.geometries.point = geometry;

      const material = this.createPointLightMaterial();
      this.materials.point = material;

      // Set initial texture if available
      if (this.lightsSystem.pointLightTexture.value) {
        material.uniforms.lightTexture.value = this.lightsSystem.pointLightTexture.value;
        material.uniforms.lightTextureWidth.value = this.lightsSystem.lightTextureWidth;
        material.uniformsNeedUpdate = true;
      }

      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1000;
      this.meshes.point = mesh;
      this.group.add(mesh);
    }

    // Create spot light visualization
    if (spotCount > 0) {
      const geometry = new PlaneGeometry(1, 1);
      geometry.isInstancedBufferGeometry = true;
      geometry.instanceCount = spotCount;
      this.geometries.spot = geometry;

      const material = this.createSpotLightMaterial();
      this.materials.spot = material;

      // Set initial texture if available
      if (this.lightsSystem.spotLightTexture.value) {
        material.uniforms.lightTexture.value = this.lightsSystem.spotLightTexture.value;
        material.uniformsNeedUpdate = true;
      }

      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1000;
      this.meshes.spot = mesh;
      this.group.add(mesh);
    }

    // Create rect light visualization
    if (rectCount > 0) {
      const geometry = new PlaneGeometry(1, 1);
      geometry.isInstancedBufferGeometry = true;
      geometry.instanceCount = rectCount;
      this.geometries.rect = geometry;

      const material = this.createRectLightMaterial();
      this.materials.rect = material;

      // Set initial texture if available
      if (this.lightsSystem.rectLightTexture.value) {
        material.uniforms.lightTexture.value = this.lightsSystem.rectLightTexture.value;
        material.uniformsNeedUpdate = true;
      }

      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1000;
      this.meshes.rect = mesh;
      this.group.add(mesh);
    }
  }

  // Update uniforms every frame
  update(scene) {
    // Update point light texture
    if (this.materials.point && this.lightsSystem.pointLightTexture.value) {
      const texture = this.lightsSystem.pointLightTexture.value;
      if (this.materials.point.uniforms.lightTexture.value !== texture) {
        this.materials.point.uniforms.lightTexture.value = texture;
        this.materials.point.uniformsNeedUpdate = true;
      }
    }

    // Update spot light texture
    if (this.materials.spot && this.lightsSystem.spotLightTexture.value) {
      const texture = this.lightsSystem.spotLightTexture.value;
      if (this.materials.spot.uniforms.lightTexture.value !== texture) {
        this.materials.spot.uniforms.lightTexture.value = texture;
        this.materials.spot.uniformsNeedUpdate = true;
      }
    }

    // Update rect light texture
    if (this.materials.rect && this.lightsSystem.rectLightTexture.value) {
      const texture = this.lightsSystem.rectLightTexture.value;
      if (this.materials.rect.uniforms.lightTexture.value !== texture) {
        this.materials.rect.uniforms.lightTexture.value = texture;
        this.materials.rect.uniformsNeedUpdate = true;
      }
    }

    // Update other uniforms for all materials
    Object.values(this.materials).forEach(material => {
      if (material) {
        if (material.uniforms.showGlow) {
          material.uniforms.showGlow.value = this.showGlow;
        }
        if (material.uniforms.glowRadius) {
          material.uniforms.glowRadius.value = this.glowRadius;
        }
        if (material.uniforms.colorOverride) {
          material.uniforms.colorOverride.value = this.colorOverride;
        }
        if (material.uniforms.markerScale) {
          material.uniforms.markerScale.value = this.markerScale;
        }
      }
    });
  }

  setVisible(visible) {
    this.visible = visible;
    if (this.group) {
      this.group.visible = visible;
    }
  }

  setShowGlow(show) {
    this.showGlow = show;
  }

  setGlowRadius(radius) {
    this.glowRadius = radius;
  }

  setColorOverride(color) {
    this.colorOverride = color || new Vector3(-1, -1, -1);
  }

  setMarkerScale(scale) {
    this.markerScale = scale;
  }

  reinit(scene) {
    // Dispose and reinitialize when light counts change
    this.dispose(scene);
    this.init(scene);
  }

  dispose(scene) {
    if (this.group) {
      scene.remove(this.group);

      // Clear all children from group
      while(this.group.children.length > 0) {
        this.group.remove(this.group.children[0]);
      }
    }

    Object.values(this.geometries).forEach(geo => geo.dispose());
    Object.values(this.materials).forEach(mat => mat.dispose());

    this.meshes = {};
    this.geometries = {};
    this.materials = {};

    // Create new group for next init
    this.group = new Group();
  }
}
