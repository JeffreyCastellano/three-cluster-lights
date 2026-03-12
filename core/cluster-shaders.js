// glsl.js - Complete file with shader variant system
import { ShaderChunk, AdditiveBlending, RawShaderMaterial, CustomBlending, OneFactor, ZeroFactor, NoBlending } from "three";

export const lights_physical_pars_fragment = `//glsl

    uniform vec4 clusterParams;
    uniform ivec4 sliceParams;
    uniform sampler2D pointLightTexture;
    uniform sampler2D spotLightTexture;
    uniform sampler2D rectLightTexture;
    uniform vec3 lightCounts; // x=point, y=spot, z=rect
    uniform sampler2D listTexture;
    uniform usampler2D masterTexture;
    #ifdef USE_SUPER_MASTER
    uniform usampler2D superMasterTexture;
    #endif
    uniform int pointLightTextureWidth; // 2D texture layout width

    // Cluster-optimized direct lighting: single-scatter GGX
    // Skips BRDF_GGX_Multiscatter's 2× dfgLUT texture lookups per light.
    // With 1000+ clustered lights the visual difference is negligible
    // but the GPU savings are massive. Standard Three.js lights still
    // use the full RE_Direct (multiscatter) path.
    void RE_Direct_Cluster(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
        float dotNL = saturate(dot(geometryNormal, directLight.direction));
        vec3 irradiance = dotNL * directLight.color;
        reflectedLight.directSpecular += irradiance * BRDF_GGX(directLight.direction, geometryViewDir, geometryNormal, material);
        reflectedLight.directDiffuse += irradiance * BRDF_Lambert(material.diffuseColor);
    }

`;

// Stochastic sampling uniform — only injected when stochastic mode is active
export const lights_physical_pars_stochastic = `//glsl
    uniform int stochasticSamplesPerTile;
`;

// Shadow system GLSL — only injected when shadows are enabled (~200 lines saved otherwise)
export const lights_physical_pars_shadow = `//glsl
    // Shadow system — dual mode: atlas (1) or screen-space (2)
    uniform int shadowMode; // 1=atlas, 2=screen-space
    uniform sampler2D shadowAtlas;
    uniform highp sampler2D shadowDataTexture;
    uniform int shadowCandidateCount;
    uniform sampler2D sceneDepthTexture;
    uniform float shadowNear;
    uniform float shadowFar;
    uniform vec2 shadowResolution;
    uniform mat4 shadowProjMatrix;
    uniform float screenSpaceShadowIntensity;

    // Interleaved gradient noise — used for stochastic PCF jitter, temporal dithering,
    // and screen-space shadow ray jitter. Named with cluster_ prefix to avoid collision
    // with Three.js's own interleavedGradientNoise in shadowmap_pars_fragment.
    float cluster_IGN(vec2 fragCoord) {
        return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
    }

    // Linearize [0,1] depth to view-space Z
    float shadowLinearDepth(float rawDepth) {
        float d = 1.0 - rawDepth;
        return shadowNear * shadowFar / (shadowFar - d * (shadowFar - shadowNear));
    }

    // Screen-space shadow: project once, interpolate per step
    float screenSpaceShadow(vec3 viewPos, vec3 lightViewPos, vec3 viewNormal) {
        vec3 toLight = lightViewPos - viewPos;
        float dist = length(toLight);
        if (dist < 0.01) return 1.0;

        if (dot(viewNormal, toLight) < -0.2 * dist) return 1.0;

        // Guard: light at or behind camera near plane produces NaN in projection
        if (-lightViewPos.z < 0.1) return 1.0;

        vec4 fragClip = shadowProjMatrix * vec4(viewPos, 1.0);
        if (abs(fragClip.w) < 0.001) return 1.0;
        vec2 fragUV = (fragClip.xy / fragClip.w) * 0.5 + 0.5;
        float fragInvW = 1.0 / fragClip.w;

        vec4 lightClip = shadowProjMatrix * vec4(lightViewPos, 1.0);
        if (abs(lightClip.w) < 0.001) return 1.0;
        vec2 lightUV = (lightClip.xy / lightClip.w) * 0.5 + 0.5;
        float lightInvW = 1.0 / lightClip.w;

        vec2 fragUVw = fragUV * fragInvW;
        vec2 lightUVw = lightUV * lightInvW;

        float fragZ = -viewPos.z;
        float lightZ = -lightViewPos.z;

        float jitter = cluster_IGN(gl_FragCoord.xy);

        float shadow = 0.0;

        // Scale thresholds relative to distance so shadows work at any scene scale
        float scale = max(dist * 0.01, 0.01);

        // Phase 1: Contact shadows (4 steps)
        float contactRange = dist * 0.15;
        float contactHits = 0.0;
        for (int i = 0; i < 4; i++) {
            float s = (float(i) + jitter) * 0.25;
            float t = (mix(0.01, 0.15, s * s));
            float invW = mix(fragInvW, lightInvW, t);
            vec2 uv = mix(fragUVw, lightUVw, t) / invW;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
            float rayZ = mix(fragZ, lightZ, t);
            float bufferZ = shadowLinearDepth(texture(sceneDepthTexture, uv).r);
            float diff = rayZ - bufferZ;
            contactHits += smoothstep(scale * 0.1, scale * 1.2, diff) * (1.0 - smoothstep(contactRange * 0.5, contactRange, diff));
        }

        // Phase 2: Long-range occlusion (4 steps)
        float occlusionHits = 0.0;
        for (int i = 0; i < 4; i++) {
            float t = mix(0.08, 0.92, (float(i) + jitter) * 0.25);
            float invW = mix(fragInvW, lightInvW, t);
            vec2 uv = mix(fragUVw, lightUVw, t) / invW;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
            float rayZ = mix(fragZ, lightZ, t);
            float bufferZ = shadowLinearDepth(texture(sceneDepthTexture, uv).r);
            float diff = rayZ - bufferZ;
            occlusionHits += smoothstep(scale * 0.5, scale * 4.0, diff) * (1.0 - smoothstep(dist * 0.3, dist * 0.6, diff));
        }

        // Weight contact shadows higher than long-range for crisp nearby detail
        shadow = contactHits * 0.375 + occlusionHits * 0.25;
        return 1.0 - clamp(shadow * screenSpaceShadowIntensity * 2.0, 0.0, 0.95);
    }

    // Stochastic PCF with temporal jitter for softer shadows (TAA-convergent)
    float stochasticPCF(sampler2D atlas, vec2 uv, float compareDepth, float texelSize, vec2 fragCoord) {
        float noise = cluster_IGN(fragCoord);
        float angle = noise * 6.283185;
        float sa = sin(angle);
        float ca = cos(angle);
        float spread = texelSize * 1.5;
        vec2 o1 = vec2(ca, sa) * spread;
        vec2 o2 = vec2(-sa, ca) * spread;
        float s = 0.0;
        s += step(compareDepth, texture(atlas, uv + o1).r);
        s += step(compareDepth, texture(atlas, uv - o1).r);
        s += step(compareDepth, texture(atlas, uv + o2).r);
        s += step(compareDepth, texture(atlas, uv - o2).r);
        return s * 0.25;
    }

    float sampleClusterShadow(vec3 viewPos, int lightType, int lightIndex, vec3 lightViewPos, vec3 viewNormal) {
        if (shadowMode == 2) {
            return screenSpaceShadow(viewPos, lightViewPos, viewNormal);
        }

        #ifdef USE_QUAD_SHADOWS
        vec2 quadCoord = floor(gl_FragCoord.xy * 0.5) * 2.0 + 1.0;
        #else
        vec2 quadCoord = gl_FragCoord.xy;
        #endif

        for (int i = 0; i < shadowCandidateCount; i++) {
            vec4 info = texelFetch(shadowDataTexture, ivec2(0, i), 0);
            if (int(info.x) == lightType && int(info.y) == lightIndex) {
                float shadowIntensity = info.z;

                vec4 atlasInfo = texelFetch(shadowDataTexture, ivec2(1, i), 0);
                float atlasU = atlasInfo.x;
                float atlasV = atlasInfo.y;
                float tileUV = atlasInfo.z;
                float bias = atlasInfo.w;

                mat4 shadowMat;
                shadowMat[0] = texelFetch(shadowDataTexture, ivec2(2, i), 0);
                shadowMat[1] = texelFetch(shadowDataTexture, ivec2(3, i), 0);
                shadowMat[2] = texelFetch(shadowDataTexture, ivec2(4, i), 0);
                shadowMat[3] = texelFetch(shadowDataTexture, ivec2(5, i), 0);

                vec4 shadowCoord = shadowMat * vec4(viewPos, 1.0);

                // Guard: fragment behind shadow camera — fall back to screen-space
                if (shadowCoord.w < 0.001) {
                    return screenSpaceShadow(viewPos, lightViewPos, viewNormal);
                }

                shadowCoord.xyz /= shadowCoord.w;
                shadowCoord.xyz = shadowCoord.xyz * 0.5 + 0.5;

                // Outside shadow frustum — fall back to screen-space shadow
                if (shadowCoord.z < 0.0 || shadowCoord.z > 1.0 ||
                    shadowCoord.x < -0.1 || shadowCoord.x > 1.1 ||
                    shadowCoord.y < -0.1 || shadowCoord.y > 1.1) {
                    return screenSpaceShadow(viewPos, lightViewPos, viewNormal);
                }

                // Soft edge falloff to prevent hard cutoff lines at frustum boundaries
                float edgeFade = 1.0;
                edgeFade *= smoothstep(0.0, 0.1, shadowCoord.x) * smoothstep(0.0, 0.1, 1.0 - shadowCoord.x);
                edgeFade *= smoothstep(0.0, 0.1, shadowCoord.y) * smoothstep(0.0, 0.1, 1.0 - shadowCoord.y);

                vec2 uv = vec2(atlasU, atlasV) + shadowCoord.xy * tileUV;
                float texelSize = 1.0 / float(textureSize(shadowAtlas, 0).x);
                float d = shadowCoord.z - bias;

                #ifdef USE_STOCHASTIC_PCF
                float s = stochasticPCF(shadowAtlas, uv, d, texelSize, quadCoord);
                #else
                float s = 0.0;
                s += step(d, texture(shadowAtlas, uv).r);
                s += step(d, texture(shadowAtlas, uv + vec2(texelSize, 0.0)).r);
                s += step(d, texture(shadowAtlas, uv + vec2(0.0, texelSize)).r);
                s += step(d, texture(shadowAtlas, uv + vec2(texelSize, texelSize)).r);
                s *= 0.25;
                #endif

                s += (cluster_IGN(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);
                // Blend shadow toward 1.0 (unshadowed) at frustum edges
                s = mix(1.0, clamp(s, 0.0, 1.0), edgeFade);
                return mix(1.0, s, shadowIntensity);
            }
        }
        // Light not in shadow candidate list — use screen-space fallback
        return screenSpaceShadow(viewPos, lightViewPos, viewNormal);
    }
`;

// LOD-aware lighting fragments
export const lights_fragment_begin = `//glsl

    ivec2 txy = ivec2( floor(gl_FragCoord.xy) * clusterParams.xy );
    int slice = int( log( vViewPosition.z ) * clusterParams.z - clusterParams.w );

    // Clamp slice to valid range — prevents corrupted txy.x from reading wrong tile data.
    // Per-light distance checks reject lights that don't actually reach the fragment.
    slice = clamp(slice, 0, sliceParams.z - 1);

    txy.x = txy.x * sliceParams.z + slice;

    // Precompute texture sampling constants (avoid per-light recalculation)
    float width = float(pointLightTextureWidth);
    float widthInv = 1.0 / width;

    #ifdef USE_SUPER_MASTER
    // Hierarchical early-out: skip empty 8x8 super-tiles
    int superX = txy.x >> 3; // /8
    for (int block = 0; block < sliceParams.w; block += 8) {
        // super-master Y is (txy.y * sliceParams.w + block) / 8
        int superY = (txy.y * sliceParams.w + block) >> 3;
        uint superMask = texelFetch(superMasterTexture, ivec2(superX, superY), 0).r;
        if (superMask == 0u) { continue; } // skip 8 master rows at once
        int iEnd = min(block + 8, sliceParams.w);
        for (int i = block; i < iEnd; ++i) {
    #else
    for (int i = 0; i < sliceParams.w; ++i) {
    #endif

        uint master = texelFetch( masterTexture, ivec2( txy.x, txy.y * sliceParams.w + i), 0 ).r;

        int clusterIndex = 32 * i;

        for(; master != 0u ; ){

            if( ( master & 1u ) == 1u ) {

                vec4 texel = texelFetch(listTexture, ivec2(txy.x, txy.y + sliceParams.y * clusterIndex), 0);

                int lightIndex = 32 * clusterIndex;

                uvec4 utexel = uvec4(texel * 255.);

                for(int lmax = lightIndex + 32; lightIndex < lmax; lightIndex += 8){

                    uint value = utexel.x;

                    utexel.xyzw = utexel.yzwx; // rotate to iterate the rgba components

                    for( int j = 0; value != 0u; j++, value >>= 1 ) {

                        if ( ( value & 1u ) == 1u ){

                            int globalLightIndex = lightIndex + j;

                            // Determine which light type and index within that type
                            int lightType = 0;
                            int typeIndex = globalLightIndex;

                            if (globalLightIndex < int(lightCounts.x)) {
                                // Point light
                                lightType = 0;
                                typeIndex = globalLightIndex;
                            } else if (globalLightIndex < int(lightCounts.x + lightCounts.y)) {
                                // Spot light
                                lightType = 1;
                                typeIndex = globalLightIndex - int(lightCounts.x);
                            } else {
                                // Rect light
                                lightType = 2;
                                typeIndex = globalLightIndex - int(lightCounts.x + lightCounts.y);
                            }
                            
                            if (lightType == 0 && typeIndex < int(lightCounts.x)) {
                                // Point light - optimized with 2 texels
                                // 2D texture sampling - use precomputed widthInv to avoid divisions
                                float typeIdx = float(typeIndex);
                                float baseTexel = typeIdx * 2.0;
                                float rowF = floor(baseTexel * widthInv);
                                int row = int(rowF);
                                int col = int(baseTexel - rowF * width);
                                ivec2 posCoord = ivec2(col, row);

                                float nextTexel = baseTexel + 1.0;
                                float nextRowF = floor(nextTexel * widthInv);
                                int nextRow = int(nextRowF);
                                int nextCol = int(nextTexel - nextRowF * width);
                                ivec2 colorCoord = ivec2(nextCol, nextRow);

                                vec4 posRadius = texelFetch(pointLightTexture, posCoord, 0);
                                vec4 colorDecayVisible = texelFetch(pointLightTexture, colorCoord, 0);
                                
                                // Extract packed parameters
                                float packedValue = colorDecayVisible.w;
                                float decay = floor(packedValue * 0.01) * 0.1;
                                float visible = mod(floor(packedValue * 0.1), 2.0);
                                float lod = mod(packedValue, 10.0);

                                // Check visibility and LOD skip
                                if (visible < 0.5 || lod < 0.5) continue;

                                vec3 lVector = posRadius.xyz - geometryPosition;
                                float lightDistance = length( lVector );

                                if( lightDistance < posRadius.w ) {
                                    directLight.direction = lVector / lightDistance; // Reuse length instead of calling normalize()

                                    // Shadow factor for this light
                                    #ifdef USE_CLUSTER_SHADOWS
                                    float shadow = sampleClusterShadow(geometryPosition, 0, typeIndex, posRadius.xyz, geometryNormal);
                                    #else
                                    float shadow = 1.0;
                                    #endif

                                    // LOD-based quality
                                    if (lod < 1.5) {
                                        // LOD 1: Simple attenuation only
                                        float attenuation = 1.0 / (1.0 + decay * lightDistance);
                                        directLight.color = colorDecayVisible.rgb * attenuation * shadow;

                                        // Simplified direct lighting
                                        float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                        reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );
                                    } else if (lod < 2.5) {
                                        // LOD 2: Medium quality - diffuse only
                                        directLight.color = colorDecayVisible.rgb * getDistanceAttenuation( lightDistance, posRadius.w, decay ) * shadow;

                                        float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                        reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );

                                        // Simple specular approximation using correct material properties
                                        vec3 halfDir = normalize( directLight.direction + geometryViewDir );
                                        float dotNH = saturate( dot( geometryNormal, halfDir ) );
                                        float shininess = max(1.0, 2.0 / pow2(material.roughness + 0.0001));
                                        vec3 F = material.specularColor;
                                        reflectedLight.directSpecular += directLight.color * F * pow(dotNH, shininess) * dotNL;
                                    } else {
                                        // LOD 3: Full quality
                                        directLight.color = colorDecayVisible.rgb * getDistanceAttenuation( lightDistance, posRadius.w, decay ) * shadow;
                                        RE_Direct_Cluster( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
                                    }
                                }

                            } else if (lightType == 1 && typeIndex < int(lightCounts.y)) {
                                // Spot light
                                vec4 posRadius = texelFetch(spotLightTexture, ivec2(typeIndex * 4, 0), 0);
                                vec4 colorIntensity = texelFetch(spotLightTexture, ivec2(typeIndex * 4 + 1, 0), 0);
                                vec4 direction = texelFetch(spotLightTexture, ivec2(typeIndex * 4 + 2, 0), 0);
                                vec4 angleParams = texelFetch(spotLightTexture, ivec2(typeIndex * 4 + 3, 0), 0);
                                
                                // Extract visibility and LOD
                                float packedValue = angleParams.w;
                                float visible = floor(packedValue * 0.1);
                                float lod = mod(packedValue, 10.0);
                                
                                // Check visibility and LOD skip
                                if (visible < 0.5 || lod < 0.5) continue;
                                
                                vec3 lVector = posRadius.xyz - geometryPosition;
                                float distSq = dot(lVector, lVector);
                                float radiusSq = posRadius.w * posRadius.w;
                                
                                if( distSq < radiusSq ) {
                                    float lightDistance = sqrt(distSq);
                                    directLight.direction = lVector / lightDistance;

                                    float angleCos = dot( directLight.direction, direction.xyz );
                                    float spotEffect = smoothstep( angleParams.x, angleParams.y, angleCos );

                                    if (spotEffect > 0.0) {
                                        // Shadow factor for spot light
                                        #ifdef USE_CLUSTER_SHADOWS
                                        float shadow = sampleClusterShadow(geometryPosition, 1, typeIndex, posRadius.xyz, geometryNormal);
                                        #else
                                        float shadow = 1.0;
                                        #endif

                                        // LOD-based quality
                                        if (lod < 1.5) {
                                            // LOD 1: Simple
                                            float attenuation = spotEffect / (1.0 + angleParams.z * lightDistance);
                                            directLight.color = colorIntensity.rgb * colorIntensity.w * attenuation * shadow;

                                            float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                            reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );
                                        } else if (lod < 2.5) {
                                            // LOD 2: Medium
                                            directLight.color = colorIntensity.rgb * colorIntensity.w * spotEffect * getDistanceAttenuation( lightDistance, posRadius.w, angleParams.z ) * shadow;

                                            float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                            reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );

                                            vec3 halfDir = normalize( directLight.direction + geometryViewDir );
                                            float dotNH = saturate( dot( geometryNormal, halfDir ) );
                                            float shininess = max(1.0, 2.0 / pow2(material.roughness + 0.0001));
                                            vec3 F = material.specularColor;
                                            reflectedLight.directSpecular += directLight.color * F * pow(dotNH, shininess) * dotNL;
                                        } else {
                                            // LOD 3: Full
                                            directLight.color = colorIntensity.rgb * colorIntensity.w * spotEffect * getDistanceAttenuation( lightDistance, posRadius.w, angleParams.z ) * shadow;
                                            RE_Direct_Cluster( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
                                        }
                                    }
                                }

                            } else if (lightType == 2 && typeIndex < int(lightCounts.z)) {
                                // Rect light
                                vec4 posRadius = texelFetch(rectLightTexture, ivec2(typeIndex * 5, 0), 0);
                                vec4 colorIntensity = texelFetch(rectLightTexture, ivec2(typeIndex * 5 + 1, 0), 0);
                                vec4 sizeParams = texelFetch(rectLightTexture, ivec2(typeIndex * 5 + 2, 0), 0);
                                vec4 lightNormal = texelFetch(rectLightTexture, ivec2(typeIndex * 5 + 3, 0), 0);
                                vec4 lightTangent = texelFetch(rectLightTexture, ivec2(typeIndex * 5 + 4, 0), 0);
                                
                                // Extract visibility and LOD
                                float packedValue = sizeParams.w;
                                float visible = floor(packedValue * 0.1);
                                float lod = mod(packedValue, 10.0);
                                
                                // Check visibility and LOD skip
                                if (visible < 0.5 || lod < 0.5) continue;
                                
                                vec3 lightPos = posRadius.xyz;
                                vec3 L = lightPos - geometryPosition;
                                float distSq = dot(L, L);
                                float radiusSq = posRadius.w * posRadius.w;
                                
                                if( distSq < radiusSq ) {
                                    float distToLight = sqrt(distSq);
                                    L = L / distToLight;
                                    
                                    float NdotL = max(dot(geometryNormal, L), 0.0);
                                    
                                    if (NdotL > 0.0) {
                                        // LOD-based quality
                                        if (lod < 1.5) {
                                            // LOD 1: Simple point approximation
                                            float area = sizeParams.x * sizeParams.y;
                                            float attenuation = area / (distToLight * distToLight * (1.0 + sizeParams.z * distToLight * 0.1));

                                            directLight.direction = L;
                                            directLight.color = colorIntensity.rgb * colorIntensity.w * attenuation * NdotL;

                                            reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseColor );
                                        } else {
                                            // LOD 2 & 3: Full rect light calculation with pre-computed tangent
                                            vec3 right = lightTangent.xyz;
                                            vec3 up = cross(right, lightNormal.xyz);
                                            
                                            // Project the geometry position onto the light plane
                                            // NOTE: toSurface = -L * distToLight (L is already normalized)
                                            vec3 toSurfaceNormalized = -L; // Reuse normalized direction
                                            vec3 toSurface = toSurfaceNormalized * distToLight;
                                            float distToPlane = dot(toSurface, lightNormal.xyz);
                                            vec3 projectedPoint = geometryPosition - lightNormal.xyz * distToPlane;
                                            
                                            // Get 2D coordinates on the light plane
                                            vec3 planeOffset = projectedPoint - lightPos;
                                            float projRight = dot(planeOffset, right);
                                            float projUp = dot(planeOffset, up);
                                            
                                            // Calculate the angular size of the rectangle from the shading point
                                            float halfWidth = sizeParams.x * 0.5;
                                            float halfHeight = sizeParams.y * 0.5;
                                            
                                            // Simple rectangular falloff based on angle (reuse normalized direction)
                                            float cosTheta = max(0.0, dot(lightNormal.xyz, toSurfaceNormalized));
                                            
                                            // Calculate falloff based on how far outside the rectangle we are
                                            float distOutsideX = max(0.0, abs(projRight) - halfWidth);
                                            float distOutsideY = max(0.0, abs(projUp) - halfHeight);
                                            
                                            // Smooth rectangular falloff
                                            float falloff = 1.0;
                                            if (distOutsideX > 0.0 || distOutsideY > 0.0) {
                                                float falloffDist = sqrt(distOutsideX * distOutsideX + distOutsideY * distOutsideY);
                                                falloff = 1.0 / (1.0 + falloffDist * falloffDist * 0.5);
                                            }
                                            
                                            // Area-based intensity
                                            float area = sizeParams.x * sizeParams.y;
                                            float rectDistAttenuation = (area * falloff) / (distToLight * distToLight);
                                            
                                            // Apply decay
                                            rectDistAttenuation *= 1.0 / (1.0 + sizeParams.z * distToLight * 0.1);
                                            
                                            // Emission angle falloff
                                            rectDistAttenuation *= cosTheta * 10.0;

                                            directLight.direction = L;
                                            directLight.color = colorIntensity.rgb * colorIntensity.w * rectDistAttenuation * NdotL;

                                            if (lod < 2.5) {
                                                // LOD 2: Simplified
                                                reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseColor );
                                            } else {
                                                // LOD 3: Full
                                                RE_Direct_Cluster( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
       
            int inc = (master & 30u) != 0u ? 1 : 5;
            master >>= inc;
            clusterIndex += inc;
        }
    }
    #ifdef USE_SUPER_MASTER
    }
    #endif

`;

export const lights_fragment_begin_optimized = `//glsl

    ivec2 txy = ivec2( floor(gl_FragCoord.xy) * clusterParams.xy );
    int slice = int( log( vViewPosition.z ) * clusterParams.z - clusterParams.w );

    // Clamp slice to valid range — prevents corrupted txy.x from reading wrong tile data
    slice = clamp(slice, 0, sliceParams.z - 1);

    txy.x = txy.x * sliceParams.z + slice;

    // Precompute texture sampling constants (avoid per-light recalculation)
    float width = float(pointLightTextureWidth);
    float widthInv = 1.0 / width;

    #ifdef USE_SUPER_MASTER
    int superX = txy.x >> 3; // /8
    #endif

    // Process point lights first (usually most common)
    if(lightCounts.x > 0.0) {
        #ifdef USE_SUPER_MASTER
        for (int block = 0; block < sliceParams.w; block += 8) {
            int superY = (txy.y * sliceParams.w + block) >> 3;
            uint superMask = texelFetch(superMasterTexture, ivec2(superX, superY), 0).r;
            if (superMask == 0u) { continue; }
            int iEnd = min(block + 8, sliceParams.w);
            for (int i = block; i < iEnd; ++i) {
        #else
        for( int i = 0; i < sliceParams.w; i++) {
        #endif
            uint master = texelFetch( masterTexture, ivec2( txy.x, txy.y * sliceParams.w + i), 0 ).r;
            int clusterIndex = 32 * i;

            for(; master != 0u ; ){
                if( ( master & 1u ) == 1u ) {
                    vec4 texel = texelFetch(listTexture, ivec2(txy.x, txy.y + sliceParams.y * clusterIndex), 0);
                    int lightIndex = 32 * clusterIndex;
                    uvec4 utexel = uvec4(texel * 255.);

                    for(int lmax = lightIndex + 32; lightIndex < lmax; lightIndex += 8){
                        uint value = utexel.x;
                        utexel.xyzw = utexel.yzwx;
               
                        for( int j = 0; value != 0u; j++, value >>= 1 ) {
                            if ( ( value & 1u ) == 1u ){
                                int globalLightIndex = lightIndex + j;
                                
                                if (globalLightIndex < int(lightCounts.x)) {
                                    // 2D texture sampling - use precomputed widthInv to avoid divisions
                                    float lightIdx = float(globalLightIndex);
                                    float baseTexel = lightIdx * 2.0;
                                    float rowF = floor(baseTexel * widthInv);
                                    int row = int(rowF);
                                    int col = int(baseTexel - rowF * width);
                                    ivec2 posCoord = ivec2(col, row);

                                    float nextTexel = baseTexel + 1.0;
                                    float nextRowF = floor(nextTexel * widthInv);
                                    int nextRow = int(nextRowF);
                                    int nextCol = int(nextTexel - nextRowF * width);
                                    ivec2 colorCoord = ivec2(nextCol, nextRow);

                                    vec4 posRadius = texelFetch(pointLightTexture, posCoord, 0);
                                    vec4 colorDecayVisible = texelFetch(pointLightTexture, colorCoord, 0);
                                    
                                    // Extract packed parameters
                                    float packedValue = colorDecayVisible.w;
                                    float decay = floor(packedValue * 0.01) * 0.1;
                                    float visible = mod(floor(packedValue * 0.1), 2.0);
                                    float lod = mod(packedValue, 10.0);

                                    // Check visibility and LOD skip
                                    if (visible < 0.5 || lod < 0.5) continue;
                                    
                                    vec3 lVector = posRadius.xyz - geometryPosition;
                                    float distSq = dot(lVector, lVector);
                                    float radiusSq = posRadius.w * posRadius.w;
                                    
                                    if( distSq < radiusSq ) {
                                        float lightDistance = sqrt(distSq);
                                        directLight.direction = lVector / lightDistance;

                                        #ifdef USE_CLUSTER_SHADOWS
                                        float shadow = sampleClusterShadow(geometryPosition, 0, globalLightIndex, posRadius.xyz, geometryNormal);
                                        #else
                                        float shadow = 1.0;
                                        #endif

                                        // LOD-based quality
                                        if (lod < 1.5) {
                                            // Simple
                                            float attenuation = 1.0 / (1.0 + decay * lightDistance);
                                            vec3 lightColor = colorDecayVisible.rgb * attenuation * shadow;
                                            float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                            reflectedLight.directDiffuse += dotNL * lightColor * BRDF_Lambert( material.diffuseColor );
                                        } else {
                                            // Full
                                            directLight.color = colorDecayVisible.rgb * getDistanceAttenuation( lightDistance, posRadius.w, decay ) * shadow;
                                            RE_Direct_Cluster( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                int inc = (master & 30u) != 0u ? 1 : 5;
                master >>= inc;
                clusterIndex += inc;
            }
        }
        #ifdef USE_SUPER_MASTER
        }
        #endif
    }
    
    // Process spot lights if any
    if(lightCounts.y > 0.0) {
        #ifdef USE_SUPER_MASTER
        for (int block = 0; block < sliceParams.w; block += 8) {
            int superY = (txy.y * sliceParams.w + block) >> 3;
            uint superMask = texelFetch(superMasterTexture, ivec2(superX, superY), 0).r;
            if (superMask == 0u) { continue; }
            int iEnd = min(block + 8, sliceParams.w);
            for (int i = block; i < iEnd; ++i) {
        #else
        for( int i = 0; i < sliceParams.w; i++) {
        #endif
            uint master = texelFetch( masterTexture, ivec2( txy.x, txy.y * sliceParams.w + i), 0 ).r;
            int clusterIndex = 32 * i;

            for(; master != 0u ; ){
                if( ( master & 1u ) == 1u ) {
                    vec4 texel = texelFetch(listTexture, ivec2(txy.x, txy.y + sliceParams.y * clusterIndex), 0);
                    int lightIndex = 32 * clusterIndex;
                    uvec4 utexel = uvec4(texel * 255.);

                    for(int lmax = lightIndex + 32; lightIndex < lmax; lightIndex += 8){
                        uint value = utexel.x;
                        utexel.xyzw = utexel.yzwx;
               
                        for( int j = 0; value != 0u; j++, value >>= 1 ) {
                            if ( ( value & 1u ) == 1u ){
                                int globalLightIndex = lightIndex + j;
                                int spotIndex = globalLightIndex - int(lightCounts.x);
                                
                                if (spotIndex >= 0 && spotIndex < int(lightCounts.y)) {
                                    vec4 posRadius = texelFetch(spotLightTexture, ivec2(spotIndex * 4, 0), 0);
                                    vec4 colorIntensity = texelFetch(spotLightTexture, ivec2(spotIndex * 4 + 1, 0), 0);
                                    vec4 direction = texelFetch(spotLightTexture, ivec2(spotIndex * 4 + 2, 0), 0);
                                    vec4 angleParams = texelFetch(spotLightTexture, ivec2(spotIndex * 4 + 3, 0), 0);
                                    
                                    // Extract visibility and LOD
                                    float packedValue = angleParams.w;
                                    float visible = floor(packedValue * 0.1);
                                    float lod = mod(packedValue, 10.0);
                                    
                                    // Check visibility and LOD skip
                                    if (visible < 0.5 || lod < 0.5) continue;
                                    
                                    vec3 lVector = posRadius.xyz - geometryPosition;
                                    float lightDistance = length( lVector );
                                    
                                    if( lightDistance < posRadius.w ) {
                                        directLight.direction = lVector / lightDistance;
                                        float angleCos = dot( directLight.direction, direction.xyz );

                                        if (angleCos > angleParams.x) {
                                            float spotEffect = smoothstep( angleParams.x, angleParams.y, angleCos );

                                            #ifdef USE_CLUSTER_SHADOWS
                                            float shadow = sampleClusterShadow(geometryPosition, 1, spotIndex, posRadius.xyz, geometryNormal);
                                            #else
                                            float shadow = 1.0;
                                            #endif

                                            if (lod < 1.5) {
                                                // Simple
                                                float attenuation = spotEffect / (1.0 + angleParams.z * lightDistance);
                                                vec3 lightColor = colorIntensity.rgb * colorIntensity.w * attenuation * shadow;
                                                float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                                reflectedLight.directDiffuse += dotNL * lightColor * BRDF_Lambert( material.diffuseColor );
                                            } else {
                                                // Full
                                                directLight.color = colorIntensity.rgb * colorIntensity.w * spotEffect * getDistanceAttenuation( lightDistance, posRadius.w, angleParams.z ) * shadow;
                                                RE_Direct_Cluster( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                int inc = (master & 30u) != 0u ? 1 : 5;
                master >>= inc;
                clusterIndex += inc;
            }
        }
        #ifdef USE_SUPER_MASTER
        }
        #endif
    }
    
    // Process rect lights if any
    if(lightCounts.z > 0.0) {
        #ifdef USE_SUPER_MASTER
        for (int block = 0; block < sliceParams.w; block += 8) {
            int superY = (txy.y * sliceParams.w + block) >> 3;
            uint superMask = texelFetch(superMasterTexture, ivec2(superX, superY), 0).r;
            if (superMask == 0u) { continue; }
            int iEnd = min(block + 8, sliceParams.w);
            for (int i = block; i < iEnd; ++i) {
        #else
        for( int i = 0; i < sliceParams.w; i++) {
        #endif
            uint master = texelFetch( masterTexture, ivec2( txy.x, txy.y * sliceParams.w + i), 0 ).r;
            int clusterIndex = 32 * i;

            for(; master != 0u ; ){
                if( ( master & 1u ) == 1u ) {
                    vec4 texel = texelFetch(listTexture, ivec2(txy.x, txy.y + sliceParams.y * clusterIndex), 0);
                    int lightIndex = 32 * clusterIndex;
                    uvec4 utexel = uvec4(texel * 255.);

                    for(int lmax = lightIndex + 32; lightIndex < lmax; lightIndex += 8){
                        uint value = utexel.x;
                        utexel.xyzw = utexel.yzwx;
               
                        for( int j = 0; value != 0u; j++, value >>= 1 ) {
                            if ( ( value & 1u ) == 1u ){
                                int globalLightIndex = lightIndex + j;
                                int rectIndex = globalLightIndex - int(lightCounts.x + lightCounts.y);
                                
                                if (rectIndex >= 0 && rectIndex < int(lightCounts.z)) {
                                    vec4 posRadius = texelFetch(rectLightTexture, ivec2(rectIndex * 5, 0), 0);
                                    vec4 colorIntensity = texelFetch(rectLightTexture, ivec2(rectIndex * 5 + 1, 0), 0);
                                    vec4 sizeParams = texelFetch(rectLightTexture, ivec2(rectIndex * 5 + 2, 0), 0);
                                    vec4 lightNormal = texelFetch(rectLightTexture, ivec2(rectIndex * 5 + 3, 0), 0);
                                    
                                    // Extract visibility and LOD
                                    float packedValue = sizeParams.w;
                                    float visible = floor(packedValue * 0.1);
                                    float lod = mod(packedValue, 10.0);
                                    
                                    // Check visibility and LOD skip
                                    if (visible < 0.5 || lod < 0.5) continue;
                                    
                                    vec3 L = posRadius.xyz - geometryPosition;
                                    float distToLight = length(L);
                                    
                                    if( distToLight < posRadius.w ) {
                                        L = L / distToLight;
                                        float NdotL = max(dot(geometryNormal, L), 0.0);

                                        if (NdotL > 0.0) {
                                            #ifdef USE_CLUSTER_SHADOWS
                                            float shadow = sampleClusterShadow(geometryPosition, 2, rectIndex, posRadius.xyz, geometryNormal);
                                            #else
                                            float shadow = 1.0;
                                            #endif

                                            if (lod < 1.5) {
                                                // Simple point approximation
                                                float area = sizeParams.x * sizeParams.y;
                                                float attenuation = area / (distToLight * distToLight * (1.0 + sizeParams.z * distToLight * 0.1));

                                                directLight.direction = L;
                                                vec3 lightColor = colorIntensity.rgb * colorIntensity.w * attenuation * NdotL * shadow;
                                                reflectedLight.directDiffuse += lightColor * BRDF_Lambert( material.diffuseColor );
                                            } else {
                                                // Full calculation with stable basis
                                                vec3 absNormal = abs(lightNormal.xyz);
                                                vec3 helper = absNormal.x < absNormal.y ?
                                                    (absNormal.x < absNormal.z ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)) :
                                                    (absNormal.y < absNormal.z ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
                                                vec3 right = normalize(cross(lightNormal.xyz, helper));
                                                vec3 up = cross(right, lightNormal.xyz);
                                                
                                                // toSurface = -L * distToLight (L is already normalized on line 558)
                                                float cosTheta = max(0.0, dot(lightNormal.xyz, -L)); // Reuse normalized L
                                                
                                                float area = sizeParams.x * sizeParams.y;
                                                float rectDistAttenuation = (area * cosTheta * 10.0) / (distToLight * distToLight);
                                                rectDistAttenuation *= 1.0 / (1.0 + sizeParams.z * distToLight * 0.1);
                                                
                                                directLight.direction = L;
                                                directLight.color = colorIntensity.rgb * colorIntensity.w * rectDistAttenuation * NdotL * shadow;
                                                RE_Direct_Cluster( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                int inc = (master & 30u) != 0u ? 1 : 5;
                master >>= inc;
                clusterIndex += inc;
            }
        }
        #ifdef USE_SUPER_MASTER
        }
        #endif
    }

`;

// ULTRA OPTIMIZED: Point-lights-only fast path with minimal branching
export const lights_fragment_ultra_optimized = `//glsl
    // Single cluster traversal, optimized for point lights only
    ivec2 txy = ivec2( floor(gl_FragCoord.xy) * clusterParams.xy );
    int slice = int( log( vViewPosition.z ) * clusterParams.z - clusterParams.w );

    // Clamp slice to valid range — prevents corrupted txy.x from reading wrong tile data
    slice = clamp(slice, 0, sliceParams.z - 1);

    txy.x = txy.x * sliceParams.z + slice;

    // Precompute constants to avoid per-light recalculation
    float width = float(pointLightTextureWidth);
    float widthInv = 1.0 / width;
    int pointCount = int(lightCounts.x);

    #ifdef USE_SUPER_MASTER
    // Hierarchical early-out: skip empty 8x8 super-tiles
    int superX = txy.x >> 3; // /8
    for (int block = 0; block < sliceParams.w; block += 8) {
        int superY = (txy.y * sliceParams.w + block) >> 3;
        uint superMask = texelFetch(superMasterTexture, ivec2(superX, superY), 0).r;
        if (superMask == 0u) { continue; }
        int iEnd = min(block + 8, sliceParams.w);
        for (int i = block; i < iEnd; ++i) {
    #else
    for( int i = 0; i < sliceParams.w; i++) {
    #endif
        uint master = texelFetch( masterTexture, ivec2( txy.x, txy.y * sliceParams.w + i), 0 ).r;
        if (master == 0u) continue; // Early skip empty clusters

        int clusterIndex = 32 * i;

        for(; master != 0u ; ){
            if( ( master & 1u ) == 1u ) {
                vec4 texel = texelFetch(listTexture, ivec2(txy.x, txy.y + sliceParams.y * clusterIndex), 0);
                int lightIndex = 32 * clusterIndex;
                uvec4 utexel = uvec4(texel * 255.);

                for(int lmax = lightIndex + 32; lightIndex < lmax; lightIndex += 8){
                    uint value = utexel.x;
                    utexel.xyzw = utexel.yzwx;

                    for( int j = 0; value != 0u; j++, value >>= 1 ) {
                        if ( ( value & 1u ) == 1u ){
                            int typeIndex = lightIndex + j;

                            // Bounds check only
                            if (typeIndex >= pointCount) continue;

                            // Optimized 2D texture sampling - minimize divisions
                            float baseTexel = float(typeIndex) * 2.0;
                            float rowF = floor(baseTexel * widthInv);
                            int row = int(rowF);
                            int col = int(baseTexel - rowF * width);

                            // Second texel coordinate (baseTexel + 1)
                            int col2 = col + 1;
                            int row2 = row;
                            if (col2 >= int(width)) {
                                col2 = 0;
                                row2 = row + 1;
                            }

                            vec4 posRadius = texelFetch(pointLightTexture, ivec2(col, row), 0);
                            vec4 colorDecayVisible = texelFetch(pointLightTexture, ivec2(col2, row2), 0);

                            // Fast visibility/LOD check (packed in w component)
                            float packed = colorDecayVisible.w;
                            float visLod = mod(packed, 100.0); // visible*10 + lod
                            if (visLod < 10.5) continue; // Skip if invisible or LOD=0

                            vec3 lVector = posRadius.xyz - geometryPosition;
                            float distSq = dot(lVector, lVector);
                            float radiusSq = posRadius.w * posRadius.w;

                            if( distSq < radiusSq ) {
                                float lightDistance = sqrt(distSq);
                                directLight.direction = lVector / lightDistance; // Normalize using precomputed 1/dist

                                // Shadow factor for this light
                                #ifdef USE_CLUSTER_SHADOWS
                                float shadow = sampleClusterShadow(geometryPosition, 0, typeIndex, posRadius.xyz, geometryNormal);
                                #else
                                float shadow = 1.0;
                                #endif

                                // LOD-based lighting - simplified branching
                                float lod = mod(visLod, 10.0);
                                float decay = floor(packed * 0.01) * 0.1;

                                if (lod > 2.5) {
                                    // LOD 3: Full quality PBR (single-scatter GGX, avoids r183+ multiscatter overhead)
                                    directLight.color = colorDecayVisible.rgb * getDistanceAttenuation( lightDistance, posRadius.w, decay ) * shadow;
                                    RE_Direct_Cluster( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
                                } else if (lod > 1.5) {
                                    // LOD 2: Medium quality - diffuse + simplified specular
                                    directLight.color = colorDecayVisible.rgb * getDistanceAttenuation( lightDistance, posRadius.w, decay ) * shadow;
                                    float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                    reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );

                                    // Fast specular approximation
                                    vec3 halfDir = normalize( directLight.direction + geometryViewDir );
                                    float dotNH = saturate( dot( geometryNormal, halfDir ) );
                                    float shininess = max(1.0, 2.0 / pow2(material.roughness + 0.0001));
                                    reflectedLight.directSpecular += directLight.color * material.specularColor * pow(dotNH, shininess) * dotNL;
                                } else {
                                    // LOD 1: Simple - diffuse only with fast attenuation
                                    vec3 lightColor = colorDecayVisible.rgb / (1.0 + decay * lightDistance) * shadow;
                                    float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                    reflectedLight.directDiffuse += dotNL * lightColor * BRDF_Lambert( material.diffuseColor );
                                }
                            }
                        }
                    }
                }
            }
            int inc = (master & 30u) != 0u ? 1 : 5;
            master >>= inc;
            clusterIndex += inc;
        }
    }
    #ifdef USE_SUPER_MASTER
    }
    #endif

`;

// Stochastic light sampling variant (STB-inspired, SIGGRAPH 2025)
// Fixed-cost per-tile: reservoir-sample N lights weighted by importance,
// then shade only those N lights with proper compensation weights.
// This is a separate string (not #ifdef'd) to avoid bloating the standard shader.
export const lights_fragment_begin_stochastic = `//glsl

    ivec2 txy = ivec2( floor(gl_FragCoord.xy) * clusterParams.xy );
    int slice = int( log( vViewPosition.z ) * clusterParams.z - clusterParams.w );

    // Clamp slice to valid range — prevents corrupted txy.x from reading wrong tile data
    slice = clamp(slice, 0, sliceParams.z - 1);

    txy.x = txy.x * sliceParams.z + slice;

    float width = float(pointLightTextureWidth);
    float widthInv = 1.0 / width;

    // Reservoir storage (max 8 samples)
    const int MAX_STOCHASTIC = 8;
    int res_type[MAX_STOCHASTIC];
    int res_idx[MAX_STOCHASTIC];
    float res_weight[MAX_STOCHASTIC];
    float res_totalW = 0.0;
    int res_count = 0;
    int res_N = min(stochasticSamplesPerTile, MAX_STOCHASTIC);

    float res_seed = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

    // --- Pass 1: Iterate cluster lights, build reservoir ---
    #ifdef USE_SUPER_MASTER
    int superX_s = txy.x >> 3;
    for (int block_s = 0; block_s < sliceParams.w; block_s += 8) {
        int superY_s = (txy.y * sliceParams.w + block_s) >> 3;
        uint superMask_s = texelFetch(superMasterTexture, ivec2(superX_s, superY_s), 0).r;
        if (superMask_s == 0u) { continue; }
        int iEnd_s = min(block_s + 8, sliceParams.w);
        for (int i_s = block_s; i_s < iEnd_s; ++i_s) {
    #else
    for (int i_s = 0; i_s < sliceParams.w; ++i_s) {
    #endif

        uint master_s = texelFetch(masterTexture, ivec2(txy.x, txy.y * sliceParams.w + i_s), 0).r;
        int clusterIndex_s = 32 * i_s;

        for (; master_s != 0u; ) {
            if ((master_s & 1u) == 1u) {
                vec4 texel_s = texelFetch(listTexture, ivec2(txy.x, txy.y + sliceParams.y * clusterIndex_s), 0);
                int lightIndex_s = 32 * clusterIndex_s;
                uvec4 utexel_s = uvec4(texel_s * 255.);

                for (int lmax_s = lightIndex_s + 32; lightIndex_s < lmax_s; lightIndex_s += 8) {
                    uint value_s = utexel_s.x;
                    utexel_s.xyzw = utexel_s.yzwx;

                    for (int j_s = 0; value_s != 0u; j_s++, value_s >>= 1) {
                        if ((value_s & 1u) == 1u) {
                            int gli = lightIndex_s + j_s;
                            int lt = 0;
                            int ti = gli;

                            if (gli < int(lightCounts.x)) {
                                lt = 0; ti = gli;
                            } else if (gli < int(lightCounts.x + lightCounts.y)) {
                                lt = 1; ti = gli - int(lightCounts.x);
                            } else {
                                lt = 2; ti = gli - int(lightCounts.x + lightCounts.y);
                            }

                            // Compute approximate importance (luminance / distance²)
                            float importance = 0.001;
                            if (lt == 0 && ti < int(lightCounts.x)) {
                                float typeIdx_s = float(ti);
                                float baseTexel_s = typeIdx_s * 2.0;
                                float rowF_s = floor(baseTexel_s * widthInv);
                                ivec2 posCoord_s = ivec2(int(baseTexel_s - rowF_s * width), int(rowF_s));
                                vec4 posRadius_s = texelFetch(pointLightTexture, posCoord_s, 0);
                                vec3 dv = posRadius_s.xyz - geometryPosition;
                                float d2 = dot(dv, dv);
                                if (d2 < posRadius_s.w * posRadius_s.w) {
                                    importance = 1.0 / max(d2, 0.01);
                                }
                            } else if (lt == 1 && ti < int(lightCounts.y)) {
                                vec4 posRadius_s = texelFetch(spotLightTexture, ivec2(ti * 4, 0), 0);
                                vec3 dv = posRadius_s.xyz - geometryPosition;
                                float d2 = dot(dv, dv);
                                if (d2 < posRadius_s.w * posRadius_s.w) {
                                    importance = 1.0 / max(d2, 0.01);
                                }
                            } else if (lt == 2 && ti < int(lightCounts.z)) {
                                vec4 posRadius_s = texelFetch(rectLightTexture, ivec2(ti * 5, 0), 0);
                                vec3 dv = posRadius_s.xyz - geometryPosition;
                                float d2 = dot(dv, dv);
                                if (d2 < posRadius_s.w * posRadius_s.w) {
                                    importance = 1.0 / max(d2, 0.01);
                                }
                            }

                            // A-Chao weighted reservoir sampling (single-pass)
                            res_totalW += importance;
                            if (res_count < res_N) {
                                res_type[res_count] = lt;
                                res_idx[res_count] = ti;
                                res_weight[res_count] = importance;
                                res_count++;
                            } else {
                                float acceptP = float(res_N) * importance / res_totalW;
                                float rnd = fract(res_seed + float(gli) * 0.6180339887);
                                if (rnd < acceptP) {
                                    int replaceIdx = int(fract(rnd * 7.31) * float(res_N));
                                    replaceIdx = clamp(replaceIdx, 0, res_N - 1);
                                    res_type[replaceIdx] = lt;
                                    res_idx[replaceIdx] = ti;
                                    res_weight[replaceIdx] = importance;
                                }
                            }
                        }
                    }
                }
            }
            int inc_s = (master_s & 30u) != 0u ? 1 : 5;
            master_s >>= inc_s;
            clusterIndex_s += inc_s;
        }
    }
    #ifdef USE_SUPER_MASTER
    }
    #endif

    // Compensation weight: unbias the estimate
    float res_compensationBase = res_totalW / max(float(min(res_count, res_N)), 1.0);

    // --- Pass 2: Shade only reservoir-selected lights ---
    for (int r = 0; r < MAX_STOCHASTIC; r++) {
        if (r >= res_count || r >= res_N) break;

        int lightType = res_type[r];
        int typeIndex = res_idx[r];
        float compensation = res_compensationBase / max(res_weight[r], 0.001);

        if (lightType == 0 && typeIndex < int(lightCounts.x)) {
            float typeIdx = float(typeIndex);
            float baseTexel = typeIdx * 2.0;
            float rowF = floor(baseTexel * widthInv);
            ivec2 posCoord = ivec2(int(baseTexel - rowF * width), int(rowF));
            float nextTexel = baseTexel + 1.0;
            float nextRowF = floor(nextTexel * widthInv);
            ivec2 colorCoord = ivec2(int(nextTexel - nextRowF * width), int(nextRowF));

            vec4 posRadius = texelFetch(pointLightTexture, posCoord, 0);
            vec4 colorDecayVisible = texelFetch(pointLightTexture, colorCoord, 0);

            float packedValue = colorDecayVisible.w;
            float decay = floor(packedValue * 0.01) * 0.1;
            float visible = mod(floor(packedValue * 0.1), 2.0);
            if (visible < 0.5) continue;

            vec3 lVector = posRadius.xyz - geometryPosition;
            float lightDistance = length(lVector);

            if (lightDistance < posRadius.w) {
                directLight.direction = lVector / lightDistance;

                #ifdef USE_CLUSTER_SHADOWS
                float shadow = sampleClusterShadow(geometryPosition, 0, typeIndex, posRadius.xyz, geometryNormal);
                #else
                float shadow = 1.0;
                #endif

                directLight.color = colorDecayVisible.rgb * getDistanceAttenuation(lightDistance, posRadius.w, decay) * shadow * compensation;
                RE_Direct_Cluster(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
            }
        } else if (lightType == 1 && typeIndex < int(lightCounts.y)) {
            vec4 posRadius = texelFetch(spotLightTexture, ivec2(typeIndex * 4, 0), 0);
            vec4 colorIntensity = texelFetch(spotLightTexture, ivec2(typeIndex * 4 + 1, 0), 0);
            vec4 direction = texelFetch(spotLightTexture, ivec2(typeIndex * 4 + 2, 0), 0);
            vec4 angleParams = texelFetch(spotLightTexture, ivec2(typeIndex * 4 + 3, 0), 0);

            float packedValue = angleParams.w;
            float visible = floor(packedValue * 0.1);
            if (visible < 0.5) continue;

            vec3 lVector = posRadius.xyz - geometryPosition;
            float lightDistance = length(lVector);

            if (lightDistance < posRadius.w) {
                directLight.direction = lVector / lightDistance;
                float angleCos = dot(directLight.direction, direction.xyz);
                float spotEffect = smoothstep(angleParams.x, angleParams.y, angleCos);

                if (spotEffect > 0.0) {
                    #ifdef USE_CLUSTER_SHADOWS
                    float shadow = sampleClusterShadow(geometryPosition, 1, typeIndex, posRadius.xyz, geometryNormal);
                    #else
                    float shadow = 1.0;
                    #endif

                    directLight.color = colorIntensity.rgb * colorIntensity.w * spotEffect * getDistanceAttenuation(lightDistance, posRadius.w, angleParams.z) * shadow * compensation;
                    RE_Direct_Cluster(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
                }
            }
        } else if (lightType == 2 && typeIndex < int(lightCounts.z)) {
            vec4 posRadius = texelFetch(rectLightTexture, ivec2(typeIndex * 5, 0), 0);
            vec4 colorIntensity = texelFetch(rectLightTexture, ivec2(typeIndex * 5 + 1, 0), 0);
            vec4 sizeParams = texelFetch(rectLightTexture, ivec2(typeIndex * 5 + 2, 0), 0);
            vec4 lightNormal = texelFetch(rectLightTexture, ivec2(typeIndex * 5 + 3, 0), 0);
            vec4 lightTangent = texelFetch(rectLightTexture, ivec2(typeIndex * 5 + 4, 0), 0);

            float packedValue = sizeParams.w;
            float visible = floor(packedValue * 0.1);
            if (visible < 0.5) continue;

            vec3 lightPos = posRadius.xyz;
            vec3 L = lightPos - geometryPosition;
            float distToLight = length(L);

            if (distToLight < posRadius.w) {
                L = L / distToLight;
                float NdotL = max(dot(geometryNormal, L), 0.0);

                if (NdotL > 0.0) {
                    vec3 right = lightTangent.xyz;
                    vec3 up = cross(right, lightNormal.xyz);
                    vec3 toSurface = -L * distToLight;
                    float distToPlane = dot(toSurface, lightNormal.xyz);
                    vec3 projectedPoint = geometryPosition - lightNormal.xyz * distToPlane;
                    vec3 planeOffset = projectedPoint - lightPos;
                    float projRight = dot(planeOffset, right);
                    float projUp = dot(planeOffset, up);
                    float halfWidth = sizeParams.x * 0.5;
                    float halfHeight = sizeParams.y * 0.5;
                    float cosTheta = max(0.0, dot(lightNormal.xyz, -L));
                    float distOutsideX = max(0.0, abs(projRight) - halfWidth);
                    float distOutsideY = max(0.0, abs(projUp) - halfHeight);
                    float falloff = 1.0;
                    if (distOutsideX > 0.0 || distOutsideY > 0.0) {
                        float falloffDist = sqrt(distOutsideX * distOutsideX + distOutsideY * distOutsideY);
                        falloff = 1.0 / (1.0 + falloffDist * falloffDist * 0.5);
                    }
                    float area = sizeParams.x * sizeParams.y;
                    float rectDistAttenuation = (area * falloff) / (distToLight * distToLight);
                    rectDistAttenuation *= 1.0 / (1.0 + sizeParams.z * distToLight * 0.1);
                    rectDistAttenuation *= cosTheta * 10.0;

                    directLight.direction = L;
                    directLight.color = colorIntensity.rgb * colorIntensity.w * rectDistAttenuation * NdotL * compensation;
                    RE_Direct_Cluster(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
                }
            }
        }
    }

`;

// Shader variant definitions (LOD always enabled)
export const ShaderVariants = {
  // Ultra-optimized point-lights-only path
  ULTRA_OPTIMIZED: {
    condition: (lights) => {
      // Use for point-only scenarios with high counts
      return lights.spotCount === 0 && lights.rectCount === 0 && lights.pointCount > 1000;
    },
    fragment: lights_fragment_ultra_optimized
  },

  // OPTIMIZED variant currently does 3× traversal (point, spot, rect loops)
  // Only use it when it's actually point-only to avoid performance regression
  OPTIMIZED: {
    condition: (lights) => {
      // Only use this for point-only with moderate counts (ULTRA takes high counts)
      return lights.spotCount === 0 && lights.rectCount === 0 && 
             lights.pointCount >= 500 && lights.pointCount <= 1000;
    },
    fragment: lights_fragment_begin_optimized
  },

  // Full featured path with LOD (default) - single-pass traversal for mixed lights
  FULL_FEATURED: {
    condition: () => true, // Default - handles mixed lights with single traversal
    fragment: lights_fragment_begin
  }
};


export function getListMaterial() {
    return new RawShaderMaterial({
        depthTest: false,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneFactor,
        premultipliedAlpha: true,
        uniforms: {
            nearZ: null,
            sliceParams: null,
            clusterParams: null,
            batchCount: null,
            pointLightTexture: null,
            spotLightTexture: null,
            rectLightTexture: null,
            lightCounts: null,
            projectionMatrix: { value: null },
            pointLightTextureWidth: null,
        },
        glslVersion: "300 es",
        vertexShader: `//glsl
            precision highp float;
            precision highp int;
            precision highp sampler2D;

            in vec3 position;

            uniform ivec4 sliceParams;
            uniform vec4 clusterParams;
            uniform float batchCount;
            uniform float nearZ;
            uniform mat4 projectionMatrix;
            uniform vec3 lightCounts;
            uniform highp sampler2D pointLightTexture;
            uniform highp sampler2D spotLightTexture;
            uniform highp sampler2D rectLightTexture;
            uniform int pointLightTextureWidth;


            flat out ivec2 vClusters;
            flat out int vID;

            float square(float v) { return v * v;}
           
            vec2 project_sphere_flat(float view_xy, float view_z, float radius)
            {
                float len = length(vec2(view_xy, view_z));
                float sin_xy = radius / len;
            
                vec2 result;
            
                if (sin_xy < 0.999)
                {
                    float cos_xy = sqrt(1.0 - sin_xy * sin_xy);
                    
                    vec2 rot_lo = mat2(cos_xy, sin_xy, -sin_xy, cos_xy) * vec2(view_xy, view_z);
                    vec2 rot_hi = mat2(cos_xy, -sin_xy, +sin_xy, cos_xy) * vec2(view_xy, view_z);
            
                    if (rot_lo.y <= nearZ)
                        rot_lo = vec2(-1.0, 1.0);
                    if (rot_hi.y <= nearZ)
                        rot_hi = vec2(1.0, 1.0);
            
                    result = vec2(rot_lo.x / rot_lo.y, rot_hi.x / rot_hi.y);
                }
                else
                {
                    result = vec2(-1.0, 1.0);
                }
            
                return result;
            }
            
           
            void main() {
                vID = gl_InstanceID;

                // Determine which texture to read from
                vec4 view;
                vec4 params;
                float lod = 3.0; // default to full quality

                if (gl_InstanceID < int(lightCounts.x)) {
                    // 2D texture sampling - use float to avoid int overflow
                    float lightIdx = float(gl_InstanceID);
                    float baseTexel = lightIdx * 2.0;
                    float width = float(pointLightTextureWidth);
                    int row = int(floor(baseTexel / width));
                    int col = int(baseTexel - float(row) * width);
                    ivec2 posCoord = ivec2(col, row);

                    float nextTexel = baseTexel + 1.0;
                    int nextRow = int(floor(nextTexel / width));
                    int nextCol = int(nextTexel - float(nextRow) * width);
                    ivec2 colorCoord = ivec2(nextCol, nextRow);

                    view = texelFetch(pointLightTexture, posCoord, 0);
                    vec4 colorDecayVisible = texelFetch(pointLightTexture, colorCoord, 0);

                    // Extract visibility and LOD from packed value
                    float packedValue = colorDecayVisible.w;
                    float visible = mod(floor(packedValue * 0.1), 2.0);
                    lod = mod(packedValue, 10.0);
                    params = vec4(0.0, visible, 0.0, 0.0);
                } else if (gl_InstanceID < int(lightCounts.x + lightCounts.y)) {
                    // Spot light
                    int spotIndex = gl_InstanceID - int(lightCounts.x);
                    view = texelFetch(spotLightTexture, ivec2(spotIndex * 4, 0), 0);
                    params = texelFetch(spotLightTexture, ivec2(spotIndex * 4 + 3, 0), 0);
                    float packedValue = params.w;
                    float visible = floor(packedValue * 0.1);
                    lod = mod(packedValue, 10.0);
                    params.y = visible;
                } else {
                    // Rect light
                    int rectIndex = gl_InstanceID - int(lightCounts.x + lightCounts.y);
                    view = texelFetch(rectLightTexture, ivec2(rectIndex * 5, 0), 0);
                    params = texelFetch(rectLightTexture, ivec2(rectIndex * 5 + 2, 0), 0);
                    float packedValue = params.w;
                    float visible = floor(packedValue * 0.1);
                    lod = mod(packedValue, 10.0);
                    params.y = visible;
                }

                // Check visibility and LOD
                float visibility = (gl_InstanceID < int(lightCounts.x)) ? params.y : params.y;
                if (visibility < 0.5 || lod < 0.5) {
                    gl_Position = vec4(10., 10., 0., 1.);
                    return;
                }
                 
                float radius = view.w;

                if(view.z > radius - nearZ) {
                    gl_Position = vec4(10., 10., 0., 1.);
                    return;
                }

                view.z = -view.z;

                float P00 = projectionMatrix[0][0];
                float P11 = projectionMatrix[1][1];

                vec2 hor = project_sphere_flat(view.x, view.z, radius) * P00;
                vec2 ver = project_sphere_flat(view.y, view.z, radius) * P11;

                if(hor.x > 1. || hor.y < -1. || ver.x > 1. || ver.y < -1.) {
                    gl_Position = vec4(10., 10., 0., 1.);
                    return;
                }

                vClusters.x = int( log( view.z - radius ) * clusterParams.z - clusterParams.w );
                vClusters.y = int( log( view.z + radius ) * clusterParams.z - clusterParams.w );

                float px = position.x < 0. ? hor.x : hor.y;
                float py = position.y < 0. ? ver.x : ver.y;
                
                px = 0.5 * (  px + 1.);
                py = 0.5 * (  py + 1.);
                
                float sx = float(sliceParams.x);
                float sy = float(sliceParams.y);

                // Snap to tile boundaries
                px = position.x < 0. ?  floor(sx * px) / sx : ceil(sx * px) / sx;
                py = position.y < 0. ?  floor(sy * py) / sy : ceil(sy * py) / sy;
                
                py = max( 0., min( 1., py));
                py = ( float(vID / 32)  +  py ) / batchCount;
                
                px = 2. * px - 1.;
                py = 2. * py - 1.;

                gl_Position = vec4( px, py, 0., 1. );
            }
        `,

        fragmentShader: `//glsl
            precision highp float;
            precision highp int;
            
            uniform ivec4 sliceParams;

            flat in ivec2 vClusters;
            flat in int vID;
            
            layout(location = 0) out highp vec4 subtile;

            void main() {
                
                int z = int( gl_FragCoord.x ) % sliceParams.z;

                if( z < vClusters.x || z > vClusters.y) discard;
                
                int id = vID & 31;

                float v = float( 1 << (id & 7)) / 255.;

                subtile = id > 15 ? ( id > 23 ? vec4( 0., 0., 0., v ) : vec4( 0., 0., v, 0. ) ) : ( id < 8 ? vec4( v, 0., 0., 0. ) : vec4( 0., v, 0., 0. ) );
            }
        `
    })
}


export function getMasterMaterial() {

    return new RawShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
            batchCount: null,
            sliceParams: null,
            listTexture: null,
        },
        glslVersion:"300 es",
        vertexShader: `//glsl
            precision highp float;
            precision highp int;

            in vec3 position;

            void main() {
                gl_Position = vec4(position.xyz, 1.);
            }

        `,

        fragmentShader: `//glsl
            precision highp float;
            precision highp int;
            precision highp sampler2D;

            uniform int batchCount;
            uniform ivec4 sliceParams;

            uniform sampler2D listTexture;

            layout(location = 0) out highp uint cluster;

            void main() {

                int x = int( gl_FragCoord.x );
                int y = int( gl_FragCoord.y );

                int mc = y % sliceParams.w;

                y /= sliceParams.w;

                int ts = 32 * mc;
                int te = min(ts + 32, batchCount);

                cluster = 0u;

                for(; ts < te; ts++) {

                    if( texelFetch( listTexture, ivec2(x, y + ts * sliceParams.y), 0 ) != vec4(0.) ) cluster |= 1u << (ts & 31);

                }

            }

        `
    })

}


export function getSuperMasterMaterial() {

    return new RawShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
            masterTexture: null,
            sliceParams: null,
        },
        glslVersion:"300 es",
        vertexShader: `//glsl
            precision highp float;
            precision highp int;

            in vec3 position;

            void main() {
                gl_Position = vec4(position.xyz, 1.);
            }

        `,

        fragmentShader: `//glsl
            precision highp float;
            precision highp int;
            precision highp usampler2D;

            uniform ivec4 sliceParams;
            uniform usampler2D masterTexture;

            layout(location = 0) out highp uint superCluster;

            void main() {
                // Each super-tile is 8×8 regular tiles
                // But master texture has layout: width = tp.x * tp.z, height = tp.y * tp.w
                // So each row in master corresponds to sliceParams.w separate 32-cluster bitfields

                int superX = int(gl_FragCoord.x);
                int superY = int(gl_FragCoord.y);

                // Get master texture dimensions
                ivec2 masterSize = textureSize(masterTexture, 0);

                // OR together up to 8×8 tiles
                superCluster = 0u;

                // The master texture is organized as:
                // Each y-row contains sliceParams.w rows of clusters
                // We need to sample the master texture more carefully

                for (int dy = 0; dy < 8; dy++) {
                    for (int dx = 0; dx < 8; dx++) {
                        // Calculate the tile coordinates
                        int tileX = superX * 8 + dx;
                        int tileY = superY * 8 + dy;

                        // Bounds check
                        if (tileX >= masterSize.x || tileY >= masterSize.y) continue;

                        // Read the master texture at this tile
                        uint tileMask = texelFetch(masterTexture, ivec2(tileX, tileY), 0).r;

                        if (tileMask != 0u) {
                            superCluster = 1u; // Mark super-tile as occupied
                            return; // Early exit - found at least one occupied tile
                        }
                    }
                }
            }

        `
    })

}