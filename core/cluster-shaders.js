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

`;

// LOD-aware lighting fragments
export const lights_fragment_begin = `//glsl

    ivec2 txy = ivec2( floor(gl_FragCoord.xy) * clusterParams.xy );
    int slice = int( log( vViewPosition.z ) * clusterParams.z - clusterParams.w );

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

                                    // LOD-based quality
                                    if (lod < 1.5) {
                                        // LOD 1: Simple attenuation only
                                        float attenuation = 1.0 / (1.0 + decay * lightDistance);
                                        directLight.color = colorDecayVisible.rgb * attenuation;

                                        // Simplified direct lighting
                                        float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                        reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );
                                    } else if (lod < 2.5) {
                                        // LOD 2: Medium quality - diffuse only
                                        directLight.color = colorDecayVisible.rgb * getDistanceAttenuation( lightDistance, posRadius.w, decay );

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
                                        directLight.color = colorDecayVisible.rgb * getDistanceAttenuation( lightDistance, posRadius.w, decay );
                                        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
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

                                        // LOD-based quality
                                        if (lod < 1.5) {
                                            // LOD 1: Simple
                                            float attenuation = spotEffect / (1.0 + angleParams.z * lightDistance);
                                            directLight.color = colorIntensity.rgb * colorIntensity.w * attenuation;

                                            float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                            reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );
                                        } else if (lod < 2.5) {
                                            // LOD 2: Medium
                                            directLight.color = colorIntensity.rgb * colorIntensity.w * spotEffect * getDistanceAttenuation( lightDistance, posRadius.w, angleParams.z );

                                            float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                            reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );

                                            vec3 halfDir = normalize( directLight.direction + geometryViewDir );
                                            float dotNH = saturate( dot( geometryNormal, halfDir ) );
                                            float shininess = max(1.0, 2.0 / pow2(material.roughness + 0.0001));
                                            vec3 F = material.specularColor;
                                            reflectedLight.directSpecular += directLight.color * F * pow(dotNH, shininess) * dotNL;
                                        } else {
                                            // LOD 3: Full
                                            directLight.color = colorIntensity.rgb * colorIntensity.w * spotEffect * getDistanceAttenuation( lightDistance, posRadius.w, angleParams.z );
                                            RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
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
                                                RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
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

    txy.x = txy.x * sliceParams.z + slice;

    // Early exit for fragments too close or too far
    if(slice < 0 || slice >= sliceParams.z) return;

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
                                        
                                        // LOD-based quality
                                        if (lod < 1.5) {
                                            // Simple
                                            float attenuation = 1.0 / (1.0 + decay * lightDistance);
                                            vec3 lightColor = colorDecayVisible.rgb * attenuation;
                                            float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                            reflectedLight.directDiffuse += dotNL * lightColor * BRDF_Lambert( material.diffuseColor );
                                        } else {
                                            // Full
                                            directLight.color = colorDecayVisible.rgb * getDistanceAttenuation( lightDistance, posRadius.w, decay );
                                            RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
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
                                            
                                            if (lod < 1.5) {
                                                // Simple
                                                float attenuation = spotEffect / (1.0 + angleParams.z * lightDistance);
                                                vec3 lightColor = colorIntensity.rgb * colorIntensity.w * attenuation;
                                                float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                                reflectedLight.directDiffuse += dotNL * lightColor * BRDF_Lambert( material.diffuseColor );
                                            } else {
                                                // Full
                                                directLight.color = colorIntensity.rgb * colorIntensity.w * spotEffect * getDistanceAttenuation( lightDistance, posRadius.w, angleParams.z );
                                                RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
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
                                    vec4 posRadius = texelFetch(rectLightTexture, ivec2(rectIndex * 4, 0), 0);
                                    vec4 colorIntensity = texelFetch(rectLightTexture, ivec2(rectIndex * 4 + 1, 0), 0);
                                    vec4 sizeParams = texelFetch(rectLightTexture, ivec2(rectIndex * 4 + 2, 0), 0);
                                    vec4 lightNormal = texelFetch(rectLightTexture, ivec2(rectIndex * 4 + 3, 0), 0);
                                    
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
                                            if (lod < 1.5) {
                                                // Simple point approximation
                                                float area = sizeParams.x * sizeParams.y;
                                                float attenuation = area / (distToLight * distToLight * (1.0 + sizeParams.z * distToLight * 0.1));
                                                
                                                directLight.direction = L;
                                                vec3 lightColor = colorIntensity.rgb * colorIntensity.w * attenuation * NdotL;
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
                                                directLight.color = colorIntensity.rgb * colorIntensity.w * rectDistAttenuation * NdotL;
                                                RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
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

                                // LOD-based lighting - simplified branching
                                float lod = mod(visLod, 10.0);
                                float decay = floor(packed * 0.01) * 0.1;

                                if (lod > 2.5) {
                                    // LOD 3: Full quality PBR
                                    directLight.color = colorDecayVisible.rgb * getDistanceAttenuation( lightDistance, posRadius.w, decay );
                                    RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
                                } else if (lod > 1.5) {
                                    // LOD 2: Medium quality - diffuse + simplified specular
                                    directLight.color = colorDecayVisible.rgb * getDistanceAttenuation( lightDistance, posRadius.w, decay );
                                    float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
                                    reflectedLight.directDiffuse += dotNL * directLight.color * BRDF_Lambert( material.diffuseColor );

                                    // Fast specular approximation
                                    vec3 halfDir = normalize( directLight.direction + geometryViewDir );
                                    float dotNH = saturate( dot( geometryNormal, halfDir ) );
                                    float shininess = max(1.0, 2.0 / pow2(material.roughness + 0.0001));
                                    reflectedLight.directSpecular += directLight.color * material.specularColor * pow(dotNH, shininess) * dotNL;
                                } else {
                                    // LOD 1: Simple - diffuse only with fast attenuation
                                    vec3 lightColor = colorDecayVisible.rgb / (1.0 + decay * lightDistance);
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
            maxTileSpan: { value: 12.0 } // Limit tile overdraw (min: 8 to avoid artifacts, lower = better perf, higher = better quality)
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
            uniform float maxTileSpan; // Max tiles a light can span (prevents overdraw)

            flat out ivec2 vClusters;
            flat out int vID;

            float square(float v) { return v * v;}
           
            vec2 project_sphere_flat(float view_xy, float view_z, float radius)
            {
                float len = length(vec2(view_xy * 0.1, view_z));
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
                    view = texelFetch(rectLightTexture, ivec2(rectIndex * 4, 0), 0);
                    params = texelFetch(rectLightTexture, ivec2(rectIndex * 4 + 2, 0), 0);
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

                // CRITICAL: Clamp light radius to prevent massive tile overdraw
                // Prevents distant large lights from rendering giant quads
                float clusterCountX = float(sliceParams.x);
                float clusterCountY = float(sliceParams.y);
                float maxScreenRadius = maxTileSpan / max(clusterCountX, clusterCountY); // Normalized screen space
                
                // Clamp the effective radius based on distance to prevent huge projections
                float projectedRadius = radius / view.z; // Angular size
                float clampedRadius = min(radius, view.z * maxScreenRadius * 2.0);

                vec2 hor = project_sphere_flat(view.x, view.z, clampedRadius) * P00;
                vec2 ver = project_sphere_flat(view.y, view.z, clampedRadius) * P11;
                
                if(hor.x > 1. || hor.y < -1. || ver.x > 1. || ver.y < -1.) {
                    gl_Position = vec4(10., 10., 0., 1.);
                    return;
                }

                // Use clamped radius for depth range to match XY projection
                vClusters.x = int( log( view.z - clampedRadius ) * clusterParams.z - clusterParams.w );
                vClusters.y = int( log( view.z + clampedRadius ) * clusterParams.z - clusterParams.w );

                float px = position.x < 0. ? hor.x : hor.y;
                float py = position.y < 0. ? ver.x : ver.y;
                
                px = 0.5 * (  px + 1.);
                py = 0.5 * (  py + 1.);
                
                float sx = float(sliceParams.x);
                float sy = float(sliceParams.y);

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