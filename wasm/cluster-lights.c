// src/wasm/cluster-lights.c – Complete implementation with optimizations for mass lights
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>
#include <emscripten/emscripten.h>

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#if defined(__clang__)
#  define ALWAYS_INLINE __attribute__((always_inline)) inline
#else
#  define ALWAYS_INLINE inline
#endif

// ──────────────────────────────────────────────────────────────
//                       ANIMATION TYPES
// ──────────────────────────────────────────────────────────────
#define ANIM_NONE      0x00
#define ANIM_CIRCULAR  0x01
#define ANIM_LINEAR    0x02
#define ANIM_WAVE      0x04
#define ANIM_FLICKER   0x08
#define ANIM_PULSE     0x10
#define ANIM_ROTATE    0x20

// Linear motion modes
#define LINEAR_ONCE      0
#define LINEAR_LOOP      1
#define LINEAR_PINGPONG  2

// Pulse targets
#define PULSE_INTENSITY  0x01
#define PULSE_RADIUS     0x02

// Rotation modes
#define ROTATE_CONTINUOUS  0
#define ROTATE_SWING       1

// LOD levels
#define LOD_SKIP     0
#define LOD_SIMPLE   1
#define LOD_MEDIUM   2
#define LOD_FULL     3

// LOD distance thresholds (relative to radius)
#define LOD_SKIP_DISTANCE    30.0f
#define LOD_SIMPLE_DISTANCE  15.0f
#define LOD_MEDIUM_DISTANCE  7.0f

// ──────────────────────────────────────────────────────────────
//                       TYPES AND STRUCTURES
// ──────────────────────────────────────────────────────────────
typedef struct { float x, y, z, w; } Vec4;
typedef struct { float te[16]; } Mat4;

// Animation parameter structures
typedef struct {
    float speed;
    float radius;
} CircularParams;

typedef struct {
    Vec4 targetPos;
    float duration;
    float delay;
    uint8_t mode;
} LinearParams;

typedef struct {
    Vec4 axis;
    float speed;
    float amplitude;
    float phase;
} WaveParams;

typedef struct {
    float speed;
    float intensity;
    float seed;
} FlickerParams;

typedef struct {
    float speed;
    float amount;
    uint8_t target;
} PulseParams;

typedef struct {
    Vec4 axis;
    float speed;
    float angle;
    uint8_t mode;
} RotationParams;

// Unified animation structure
typedef struct {
    uint32_t flags;
    CircularParams circular;
    LinearParams linear;
    WaveParams wave;
    FlickerParams flicker;
    PulseParams pulse;
    RotationParams rotation;
} AnimationParams;

// Optimized light structures with LOD support
typedef struct {
    Vec4 baseWorldPos;  // Static position for Morton ordering
    Vec4 animOffset;    // Dynamic offset calculated each frame
    Vec4 worldPos;      // baseWorldPos + animOffset (for rendering)
    Vec4 color;         // rgb = color, w = intensity
    Vec4 viewPos;       // xyz = view position, w = radius
    Vec4 baseColor;     // rgb = base color, w = base intensity
    AnimationParams anim;
    float decay;
    uint32_t morton;    // ONLY calculated from baseWorldPos
    uint8_t dirty;
    uint8_t visible;
    uint8_t lodLevel;   // LOD level: 0=skip, 1=simple, 2=medium, 3=full
    uint8_t castsShadow;     // Shadow flag: 0=no shadow, 1=casts shadow
    float shadowIntensity;   // 0=pitch black, 1=no shadow
} PointLight;

typedef struct {
    Vec4 baseWorldPos;  // Static position for Morton ordering
    Vec4 animOffset;    // Dynamic offset calculated each frame
    Vec4 worldPos;      // baseWorldPos + animOffset
    Vec4 color;         // rgb = color, w = intensity
    Vec4 direction;     // xyz = direction, w = unused
    Vec4 viewPos;       // xyz = view position, w = radius
    Vec4 viewDir;       // xyz = view direction, w = unused
    Vec4 baseDir;       // xyz = base direction for rotation
    AnimationParams anim;
    float decay;
    float angle;
    float penumbra;
    uint32_t morton;
    uint8_t dirty;
    uint8_t visible;
    uint8_t lodLevel;   // LOD level
    uint8_t castsShadow;     // Shadow flag: 0=no shadow, 1=casts shadow
    float shadowIntensity;   // 0=pitch black, 1=no shadow
} SpotLight;

typedef struct {
    Vec4 baseWorldPos;  // Static position for Morton ordering
    Vec4 animOffset;    // Dynamic offset calculated each frame
    Vec4 worldPos;      // baseWorldPos + animOffset
    Vec4 color;         // rgb = color, w = intensity
    Vec4 size;          // x = width, y = height, z,w = unused
    Vec4 normal;        // xyz = normal, w = unused
    Vec4 tangent;       // xyz = tangent (right direction), w = unused
    Vec4 bitangent;     // xyz = bitangent (up direction), w = unused
    Vec4 viewPos;       // xyz = view position, w = radius
    Vec4 viewNormal;    // xyz = view normal, w = unused
    Vec4 viewTangent;   // xyz = view tangent, w = unused
    Vec4 baseNormal;    // xyz = base normal for rotation
    Vec4 baseTangent;   // xyz = base tangent for rotation
    Vec4 baseBitangent; // xyz = base bitangent for rotation
    AnimationParams anim;
    float decay;
    uint32_t morton;
    uint8_t dirty;
    uint8_t visible;
    uint8_t lodLevel;   // LOD level
    uint8_t castsShadow;     // Shadow flag: 0=no shadow, 1=casts shadow
    float shadowIntensity;   // 0=pitch black, 1=no shadow
} RectLight;

// Optimized texture data structures with LOD info
typedef struct {
    Vec4 positionRadius;    // xyz = position, w = radius
    Vec4 colorDecayVisible; // rgb = color * intensity, w = packed(decay, visible, lod)
} PointLightDataOptimized;

typedef struct {
    Vec4 positionRadius;  // xyz = position, w = radius
    Vec4 colorIntensity;  // rgb = color, w = intensity
    Vec4 direction;       // xyz = direction, w = unused
    Vec4 angleParams;     // x = cos(angle), y = cos(penumbra), z = decay, w = packed(visible, lod)
} SpotLightData;

typedef struct {
    Vec4 positionRadius;  // xyz = position, w = radius
    Vec4 colorIntensity;  // rgb = color, w = intensity
    Vec4 sizeParams;      // xy = size, z = decay, w = packed(visible, lod)
    Vec4 normal;          // xyz = normal, w = unused
    Vec4 tangent;         // xyz = tangent (right direction), w = unused
} RectLightData;

// ──────────────────────────────────────────────────────────────
//                       GLOBAL STATE
// ──────────────────────────────────────────────────────────────
static PointLight *pointLights = NULL;
static SpotLight *spotLights = NULL;
static RectLight *rectLights = NULL;

static PointLight *pointLightsScratch = NULL;
static SpotLight *spotLightsScratch = NULL;
static RectLight *rectLightsScratch = NULL;

static PointLightDataOptimized *pointLightTexture = NULL;
static SpotLightData *spotLightTexture = NULL;
static RectLightData *rectLightTexture = NULL;

static Mat4 *cameraMatrix = NULL;

static int pointLightCount = 0;
static int spotLightCount = 0;
static int rectLightCount = 0;
static int maxLights = 0;

static int hasAnimatedLights = 0;
static int needsSort = 0;

// Fast path flags
static int hasPointLights = 0;
static int hasSpotLights = 0;
static int hasRectLights = 0;

// Cached view matrix elements
static float e0,e1,e2,e4,e5,e6,e8,e9,e10,e12,e13,e14;

// SIMD cached elements
#ifdef __wasm_simd128__
static v128_t e0v, e1v, e2v, e4v, e5v, e6v, e8v, e9v, e10v, e12v, e13v, e14v;
#endif

// View frustum parameters
static float viewNear = 0.1f;
static float viewFar = 1000.0f;

// LOD settings (always enabled)
static float lodBias = 1.0f;  // Global LOD bias multiplier

// Dirty flags
#define DIRTY_POSITION 1
#define DIRTY_COLOR 2
#define DIRTY_PARAMS 4
#define DIRTY_ALL 7

// ──────────────────────────────────────────────────────────────
//                    FAST MATH & HELPERS
// ──────────────────────────────────────────────────────────────
ALWAYS_INLINE static float clampf(float v, float lo, float hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

ALWAYS_INLINE static float lerpf(float a, float b, float t) {
    return a + (b - a) * t;
}

ALWAYS_INLINE static float smoothstepf(float edge0, float edge1, float x) {
    float t = clampf((x - edge0) / (edge1 - edge0), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

ALWAYS_INLINE static uint32_t interleaveBits(uint32_t x) {
    x = (x | (x << 8))  & 0x00FF00FFu;
    x = (x | (x << 4))  & 0x0F0F0F0Fu;
    x = (x | (x << 2))  & 0x33333333u;
    x = (x | (x << 1))  & 0x55555555u;
    return x;
}

ALWAYS_INLINE static uint32_t computeMorton(float x, float z) {
    uint32_t xi = (uint32_t)x;
    uint32_t zi = (uint32_t)z;
    return interleaveBits(xi) | (interleaveBits(zi) << 1);
}

ALWAYS_INLINE static void worldToView(float x, float y, float z, float r, Vec4 *out) {
    out->x = e0 * x + e4 * y + e8  * z + e12;
    out->y = e1 * x + e5 * y + e9  * z + e13;
    out->z = e2 * x + e6 * y + e10 * z + e14;
    out->w = r;
}

ALWAYS_INLINE static void worldDirToView(const Vec4 *in, Vec4 *out) {
    out->x = e0*in->x + e4*in->y + e8 *in->z;
    out->y = e1*in->x + e5*in->y + e9 *in->z;
    out->z = e2*in->x + e6*in->y + e10*in->z;
    float len = sqrtf(out->x*out->x + out->y*out->y + out->z*out->z);
    if (len > 0.f) { 
        float inv = 1.f/len; 
        out->x*=inv; 
        out->y*=inv; 
        out->z*=inv; 
    }
}

ALWAYS_INLINE static void rotateAroundAxis(Vec4 *v, const Vec4 *axis, float angle) {
    float c = cosf(angle);
    float s = sinf(angle);
    float dot = v->x * axis->x + v->y * axis->y + v->z * axis->z;

    // Store original values before overwriting
    float vx = v->x;
    float vy = v->y;
    float vz = v->z;

    // Rodrigues' rotation formula
    v->x = vx * c + (axis->y * vz - axis->z * vy) * s + axis->x * dot * (1.0f - c);
    v->y = vy * c + (axis->z * vx - axis->x * vz) * s + axis->y * dot * (1.0f - c);
    v->z = vz * c + (axis->x * vy - axis->y * vx) * s + axis->z * dot * (1.0f - c);
}

// Build stable orthonormal basis from normal
ALWAYS_INLINE static void buildOrthonormalBasis(const Vec4 *normal, Vec4 *tangent, Vec4 *bitangent) {
    // Prefer world-up alignment so width maps to a horizontal axis when possible
    Vec4 reference = (Vec4){0.0f, 1.0f, 0.0f, 0.0f};
    if (fabsf(normal->y) >= 0.999f) {
        reference = (Vec4){1.0f, 0.0f, 0.0f, 0.0f};
    }

    // Tangent = normalize(cross(reference, normal))
    tangent->x = reference.y * normal->z - reference.z * normal->y;
    tangent->y = reference.z * normal->x - reference.x * normal->z;
    tangent->z = reference.x * normal->y - reference.y * normal->x;

    float len = sqrtf(tangent->x * tangent->x + tangent->y * tangent->y + tangent->z * tangent->z);
    if (len < 1e-6f) {
        // Fallback reference if normal nearly matches primary helper
        reference = (Vec4){0.0f, 0.0f, 1.0f, 0.0f};
        tangent->x = reference.y * normal->z - reference.z * normal->y;
        tangent->y = reference.z * normal->x - reference.x * normal->z;
        tangent->z = reference.x * normal->y - reference.y * normal->x;
        len = sqrtf(tangent->x * tangent->x + tangent->y * tangent->y + tangent->z * tangent->z);
    }

    if (len > 0.0f) {
        float inv = 1.0f / len;
        tangent->x *= inv;
        tangent->y *= inv;
        tangent->z *= inv;
    } else {
        tangent->x = 1.0f;
        tangent->y = 0.0f;
        tangent->z = 0.0f;
    }
    tangent->w = 0.0f;

    // Bitangent = normalize(cross(normal, tangent))
    bitangent->x = normal->y * tangent->z - normal->z * tangent->y;
    bitangent->y = normal->z * tangent->x - normal->x * tangent->z;
    bitangent->z = normal->x * tangent->y - normal->y * tangent->x;

    float bitLen = sqrtf(bitangent->x * bitangent->x + bitangent->y * bitangent->y + bitangent->z * bitangent->z);
    if (bitLen > 0.0f) {
        float invBit = 1.0f / bitLen;
        bitangent->x *= invBit;
        bitangent->y *= invBit;
        bitangent->z *= invBit;
    }
    bitangent->w = 0.0f;
}

// Calculate LOD level based on view distance and radius
ALWAYS_INLINE static uint8_t calculateLOD(float viewZ, float radius) {
    float distance = -viewZ;  // viewZ is negative
    float relativeDistance = distance / (radius * lodBias);

    if (relativeDistance > LOD_SKIP_DISTANCE) return LOD_SKIP;
    if (relativeDistance > LOD_SIMPLE_DISTANCE) return LOD_SIMPLE;
    if (relativeDistance > LOD_MEDIUM_DISTANCE) return LOD_MEDIUM;
    return LOD_FULL;
}

#ifdef __wasm_simd128__
// SIMD version: Calculate 4 LOD levels at once
ALWAYS_INLINE static void calculateLOD_SIMD(
    float viewZ0, float radius0,
    float viewZ1, float radius1,
    float viewZ2, float radius2,
    float viewZ3, float radius3,
    uint8_t *lod0, uint8_t *lod1, uint8_t *lod2, uint8_t *lod3
) {
    // Pack 4 viewZ values
    v128_t vz = wasm_f32x4_make(-viewZ0, -viewZ1, -viewZ2, -viewZ3);

    // Pack 4 radius values and multiply by lodBias
    v128_t rad = wasm_f32x4_make(radius0 * lodBias, radius1 * lodBias,
                                  radius2 * lodBias, radius3 * lodBias);

    // Calculate relative distances (4 at once)
    v128_t relDist = wasm_f32x4_div(vz, rad);

    // Thresholds (broadcast to all lanes)
    v128_t skipThresh = wasm_f32x4_splat(LOD_SKIP_DISTANCE);
    v128_t simpleThresh = wasm_f32x4_splat(LOD_SIMPLE_DISTANCE);
    v128_t mediumThresh = wasm_f32x4_splat(LOD_MEDIUM_DISTANCE);

    // Compare: relDist > threshold produces 0xFFFFFFFF for true, 0x00000000 for false
    v128_t isSkip = wasm_f32x4_gt(relDist, skipThresh);
    v128_t isSimple = wasm_f32x4_gt(relDist, simpleThresh);
    v128_t isMedium = wasm_f32x4_gt(relDist, mediumThresh);

    // Convert comparisons to LOD values
    // If isSkip: 0, if isSimple: 1, if isMedium: 2, else: 3
    v128_t lodVec = wasm_f32x4_splat(3.0f); // Start with LOD_FULL
    lodVec = wasm_v128_bitselect(wasm_f32x4_splat(2.0f), lodVec, isMedium);
    lodVec = wasm_v128_bitselect(wasm_f32x4_splat(1.0f), lodVec, isSimple);
    lodVec = wasm_v128_bitselect(wasm_f32x4_splat(0.0f), lodVec, isSkip);

    // Extract LOD values
    *lod0 = (uint8_t)wasm_f32x4_extract_lane(lodVec, 0);
    *lod1 = (uint8_t)wasm_f32x4_extract_lane(lodVec, 1);
    *lod2 = (uint8_t)wasm_f32x4_extract_lane(lodVec, 2);
    *lod3 = (uint8_t)wasm_f32x4_extract_lane(lodVec, 3);
}
#endif

// Pack decay, visibility, and LOD into a single float for optimized texture layout
ALWAYS_INLINE static float packLightParams(float decay, uint8_t visible, uint8_t lod) {
    // Pack: decay (0-3 range) * 100 + visible * 10 + lod (0-3)
    return decay * 100.0f + (visible ? 10.0f : 0.0f) + (float)lod;
}

// Pack visibility and LOD for spot/rect lights
ALWAYS_INLINE static float packVisibleLOD(uint8_t visible, uint8_t lod) {
    return (float)(visible ? 10 : 0) + (float)lod;
}

// ──────────────────────────────────────────────────────────────
//                   ANIMATION PROCESSING
// ──────────────────────────────────────────────────────────────
ALWAYS_INLINE static void processPointLightAnimation(PointLight *l, float time) {
    // Reset offset
    l->animOffset = (Vec4){0, 0, 0, 0};
    
    // Start from base values
    l->color = l->baseColor;
    l->worldPos.w = l->baseWorldPos.w; // Base radius
    
    if (l->anim.flags == ANIM_NONE) {
        l->worldPos = l->baseWorldPos;
        return;
    }
    
    // Circular motion - as offset only
    if (l->anim.flags & ANIM_CIRCULAR) {
        float phase = time * l->anim.circular.speed;
        l->animOffset.x = sinf(phase) * l->anim.circular.radius;
        l->animOffset.z = cosf(phase) * l->anim.circular.radius;
    }
    
    // Linear motion - as offset
    if (l->anim.flags & ANIM_LINEAR) {
        if (time >= l->anim.linear.delay) {
            float t = (time - l->anim.linear.delay) / l->anim.linear.duration;
            
            if (l->anim.linear.mode == LINEAR_LOOP) {
                t = fmodf(t, 1.0f);
            } else if (l->anim.linear.mode == LINEAR_PINGPONG) {
                int cycle = (int)t;
                t = fmodf(t, 1.0f);
                if (cycle & 1) t = 1.0f - t;
            } else { // LINEAR_ONCE
                t = clampf(t, 0.0f, 1.0f);
            }
            
            l->animOffset.x = lerpf(0, l->anim.linear.targetPos.x - l->baseWorldPos.x, t);
            l->animOffset.y = lerpf(0, l->anim.linear.targetPos.y - l->baseWorldPos.y, t);
            l->animOffset.z = lerpf(0, l->anim.linear.targetPos.z - l->baseWorldPos.z, t);
        }
    }
    
    // Wave motion - as offset
    if (l->anim.flags & ANIM_WAVE) {
        float wave = sinf(time * l->anim.wave.speed + l->anim.wave.phase) * l->anim.wave.amplitude;
        l->animOffset.x += l->anim.wave.axis.x * wave;
        l->animOffset.y += l->anim.wave.axis.y * wave;
        l->animOffset.z += l->anim.wave.axis.z * wave;
    }
    
    // Apply offset to get final world position
    l->worldPos.x = l->baseWorldPos.x + l->animOffset.x;
    l->worldPos.y = l->baseWorldPos.y + l->animOffset.y;
    l->worldPos.z = l->baseWorldPos.z + l->animOffset.z;
    
    // Property animations (don't affect position)
    if (l->anim.flags & ANIM_FLICKER) {
        float flicker = 1.0f + sinf(time * l->anim.flicker.speed + l->anim.flicker.seed) * 
                              cosf(time * l->anim.flicker.speed * 1.7f + l->anim.flicker.seed * 2.3f) * 
                              l->anim.flicker.intensity;
        l->color.w = l->baseColor.w * clampf(flicker, 0.1f, 2.0f);
    }
    
    if (l->anim.flags & ANIM_PULSE) {
        float pulse = 1.0f + sinf(time * l->anim.pulse.speed) * l->anim.pulse.amount;
        if (l->anim.pulse.target & PULSE_INTENSITY) {
            l->color.w = l->baseColor.w * pulse;
        }
        if (l->anim.pulse.target & PULSE_RADIUS) {
            l->worldPos.w = l->baseWorldPos.w * pulse;
        }
    }
}

ALWAYS_INLINE static void processSpotLightAnimation(SpotLight *l, float time) {
    // Reset offset
    l->animOffset = (Vec4){0, 0, 0, 0};
    
    // Start from base values
    l->direction = l->baseDir;
    l->worldPos.w = l->baseWorldPos.w;
    
    if (l->anim.flags == ANIM_NONE) {
        l->worldPos = l->baseWorldPos;
        return;
    }
    
    // Apply position animations as offsets
    if (l->anim.flags & ANIM_LINEAR) {
        if (time >= l->anim.linear.delay) {
            float t = (time - l->anim.linear.delay) / l->anim.linear.duration;
            
            if (l->anim.linear.mode == LINEAR_LOOP) {
                t = fmodf(t, 1.0f);
            } else if (l->anim.linear.mode == LINEAR_PINGPONG) {
                int cycle = (int)t;
                t = fmodf(t, 1.0f);
                if (cycle & 1) t = 1.0f - t;
            } else {
                t = clampf(t, 0.0f, 1.0f);
            }
            
            l->animOffset.x = lerpf(0, l->anim.linear.targetPos.x - l->baseWorldPos.x, t);
            l->animOffset.y = lerpf(0, l->anim.linear.targetPos.y - l->baseWorldPos.y, t);
            l->animOffset.z = lerpf(0, l->anim.linear.targetPos.z - l->baseWorldPos.z, t);
        }
    }
    
    // Apply offset to get final world position
    l->worldPos.x = l->baseWorldPos.x + l->animOffset.x;
    l->worldPos.y = l->baseWorldPos.y + l->animOffset.y;
    l->worldPos.z = l->baseWorldPos.z + l->animOffset.z;

    // Rotation for direction AND position
    if (l->anim.flags & ANIM_ROTATE) {
        Vec4 dir = l->baseDir;
        Vec4 pos = l->worldPos;
        float angle;

        if (l->anim.rotation.mode == ROTATE_SWING) {
            angle = sinf(time * l->anim.rotation.speed) * l->anim.rotation.angle;
        } else {
            // Normalize angle to prevent floating point precision issues
            angle = fmodf(time * l->anim.rotation.speed, 2.0f * M_PI);
        }

        rotateAroundAxis(&dir, &l->anim.rotation.axis, angle);
        rotateAroundAxis(&pos, &l->anim.rotation.axis, angle);
        l->direction = dir;
        l->worldPos = pos;
    }
    
    // Flickering
    if (l->anim.flags & ANIM_FLICKER) {
        float flicker = 1.0f + sinf(time * l->anim.flicker.speed + l->anim.flicker.seed) * 
                              cosf(time * l->anim.flicker.speed * 1.7f + l->anim.flicker.seed * 2.3f) * 
                              l->anim.flicker.intensity;
        l->color.w = l->color.w * clampf(flicker, 0.1f, 2.0f);
    }
    
    // Pulsing
    if (l->anim.flags & ANIM_PULSE) {
        float pulse = 1.0f + sinf(time * l->anim.pulse.speed) * l->anim.pulse.amount;
        if (l->anim.pulse.target & PULSE_INTENSITY) {
            l->color.w = l->color.w * pulse;
        }
        if (l->anim.pulse.target & PULSE_RADIUS) {
            l->worldPos.w = l->baseWorldPos.w * pulse;
        }
    }
}

ALWAYS_INLINE static void processRectLightAnimation(RectLight *l, float time) {
    // Reset offset
    l->animOffset = (Vec4){0, 0, 0, 0};
    
    // Start from base values
    l->normal = l->baseNormal;
    l->worldPos.w = l->baseWorldPos.w;
    
    if (l->anim.flags == ANIM_NONE) {
        l->worldPos = l->baseWorldPos;
        return;
    }
    
    // Apply position animations as offsets
    if (l->anim.flags & ANIM_LINEAR) {
        if (time >= l->anim.linear.delay) {
            float t = (time - l->anim.linear.delay) / l->anim.linear.duration;
            
            if (l->anim.linear.mode == LINEAR_LOOP) {
                t = fmodf(t, 1.0f);
            } else if (l->anim.linear.mode == LINEAR_PINGPONG) {
                int cycle = (int)t;
                t = fmodf(t, 1.0f);
                if (cycle & 1) t = 1.0f - t;
            } else {
                t = clampf(t, 0.0f, 1.0f);
            }
            
            l->animOffset.x = lerpf(0, l->anim.linear.targetPos.x - l->baseWorldPos.x, t);
            l->animOffset.y = lerpf(0, l->anim.linear.targetPos.y - l->baseWorldPos.y, t);
            l->animOffset.z = lerpf(0, l->anim.linear.targetPos.z - l->baseWorldPos.z, t);
        }
    }
    
    // Apply offset to get final world position
    l->worldPos.x = l->baseWorldPos.x + l->animOffset.x;
    l->worldPos.y = l->baseWorldPos.y + l->animOffset.y;
    l->worldPos.z = l->baseWorldPos.z + l->animOffset.z;

    // Rotation for normal, tangent, and bitangent
    if (l->anim.flags & ANIM_ROTATE) {
        Vec4 norm = l->baseNormal;
        Vec4 tang = l->baseTangent;
        Vec4 bitang = l->baseBitangent;
        float angle;

        if (l->anim.rotation.mode == ROTATE_SWING) {
            angle = sinf(time * l->anim.rotation.speed) * l->anim.rotation.angle;
        } else {
            // Normalize angle to prevent floating point precision issues
            angle = fmodf(time * l->anim.rotation.speed, 2.0f * M_PI);
        }

        rotateAroundAxis(&norm, &l->anim.rotation.axis, angle);
        rotateAroundAxis(&tang, &l->anim.rotation.axis, angle);
        rotateAroundAxis(&bitang, &l->anim.rotation.axis, angle);
        l->normal = norm;
        l->tangent = tang;
        l->bitangent = bitang;
    }
    
    // Flickering
    if (l->anim.flags & ANIM_FLICKER) {
        float flicker = 1.0f + sinf(time * l->anim.flicker.speed + l->anim.flicker.seed) * 
                              cosf(time * l->anim.flicker.speed * 1.7f + l->anim.flicker.seed * 2.3f) * 
                              l->anim.flicker.intensity;
        l->color.w = l->color.w * clampf(flicker, 0.1f, 2.0f);
    }
    
    // Pulsing
    if (l->anim.flags & ANIM_PULSE) {
        float pulse = 1.0f + sinf(time * l->anim.pulse.speed) * l->anim.pulse.amount;
        if (l->anim.pulse.target & PULSE_INTENSITY) {
            l->color.w = l->color.w * pulse;
        }
    }
}

// ──────────────────────────────────────────────────────────────
//                    SIMD BATCH PROCESSING
// ──────────────────────────────────────────────────────────────
#ifdef __wasm_simd128__
static void updatePointLightsSIMD(float time) {
    int i = 0;
    
    // Cache view matrix elements for SIMD
    e0v = wasm_f32x4_splat(e0);
    e1v = wasm_f32x4_splat(e1);
    e2v = wasm_f32x4_splat(e2);
    e4v = wasm_f32x4_splat(e4);
    e5v = wasm_f32x4_splat(e5);
    e6v = wasm_f32x4_splat(e6);
    e8v = wasm_f32x4_splat(e8);
    e9v = wasm_f32x4_splat(e9);
    e10v = wasm_f32x4_splat(e10);
    e12v = wasm_f32x4_splat(e12);
    e13v = wasm_f32x4_splat(e13);
    e14v = wasm_f32x4_splat(e14);
    
    // Process 4 lights at a time with SIMD
    for (; i + 3 < pointLightCount; i += 4) {
        PointLight *l0 = &pointLights[i];
        PointLight *l1 = &pointLights[i+1];
        PointLight *l2 = &pointLights[i+2];
        PointLight *l3 = &pointLights[i+3];
        
        // Check if any have animations
        if ((l0->anim.flags | l1->anim.flags | l2->anim.flags | l3->anim.flags) != ANIM_NONE) {
            // Process animations individually
            processPointLightAnimation(l0, time);
            processPointLightAnimation(l1, time);
            processPointLightAnimation(l2, time);
            processPointLightAnimation(l3, time);
        } else {
            // No animations - just copy base positions
            l0->worldPos = l0->baseWorldPos;
            l1->worldPos = l1->baseWorldPos;
            l2->worldPos = l2->baseWorldPos;
            l3->worldPos = l3->baseWorldPos;
        }
        
        // Transform to view space using SIMD
        v128_t wx = wasm_f32x4_make(l0->worldPos.x, l1->worldPos.x, l2->worldPos.x, l3->worldPos.x);
        v128_t wy = wasm_f32x4_make(l0->worldPos.y, l1->worldPos.y, l2->worldPos.y, l3->worldPos.y);
        v128_t wz = wasm_f32x4_make(l0->worldPos.z, l1->worldPos.z, l2->worldPos.z, l3->worldPos.z);
        
        v128_t vx = wasm_f32x4_add(wasm_f32x4_add(wasm_f32x4_mul(e0v, wx), wasm_f32x4_mul(e4v, wy)), 
                                   wasm_f32x4_add(wasm_f32x4_mul(e8v, wz), e12v));
        v128_t vy = wasm_f32x4_add(wasm_f32x4_add(wasm_f32x4_mul(e1v, wx), wasm_f32x4_mul(e5v, wy)), 
                                   wasm_f32x4_add(wasm_f32x4_mul(e9v, wz), e13v));
        v128_t vz = wasm_f32x4_add(wasm_f32x4_add(wasm_f32x4_mul(e2v, wx), wasm_f32x4_mul(e6v, wy)), 
                                   wasm_f32x4_add(wasm_f32x4_mul(e10v, wz), e14v));
        
        // Extract and store results
        l0->viewPos.x = wasm_f32x4_extract_lane(vx, 0);
        l1->viewPos.x = wasm_f32x4_extract_lane(vx, 1);
        l2->viewPos.x = wasm_f32x4_extract_lane(vx, 2);
        l3->viewPos.x = wasm_f32x4_extract_lane(vx, 3);
        
        l0->viewPos.y = wasm_f32x4_extract_lane(vy, 0);
        l1->viewPos.y = wasm_f32x4_extract_lane(vy, 1);
        l2->viewPos.y = wasm_f32x4_extract_lane(vy, 2);
        l3->viewPos.y = wasm_f32x4_extract_lane(vy, 3);
        
        l0->viewPos.z = wasm_f32x4_extract_lane(vz, 0);
        l1->viewPos.z = wasm_f32x4_extract_lane(vz, 1);
        l2->viewPos.z = wasm_f32x4_extract_lane(vz, 2);
        l3->viewPos.z = wasm_f32x4_extract_lane(vz, 3);
        
        l0->viewPos.w = l0->worldPos.w;
        l1->viewPos.w = l1->worldPos.w;
        l2->viewPos.w = l2->worldPos.w;
        l3->viewPos.w = l3->worldPos.w;

        // Calculate LOD levels using SIMD (4x faster than scalar)
        calculateLOD_SIMD(
            l0->viewPos.z, l0->worldPos.w,
            l1->viewPos.z, l1->worldPos.w,
            l2->viewPos.z, l2->worldPos.w,
            l3->viewPos.z, l3->worldPos.w,
            &l0->lodLevel, &l1->lodLevel, &l2->lodLevel, &l3->lodLevel
        );
        
        // Visibility culling
        uint8_t culled0 = (l0->viewPos.z > l0->worldPos.w - viewNear || l0->viewPos.z < -viewFar - l0->worldPos.w) ? 1 : 0;
        uint8_t culled1 = (l1->viewPos.z > l1->worldPos.w - viewNear || l1->viewPos.z < -viewFar - l1->worldPos.w) ? 1 : 0;
        uint8_t culled2 = (l2->viewPos.z > l2->worldPos.w - viewNear || l2->viewPos.z < -viewFar - l2->worldPos.w) ? 1 : 0;
        uint8_t culled3 = (l3->viewPos.z > l3->worldPos.w - viewNear || l3->viewPos.z < -viewFar - l3->worldPos.w) ? 1 : 0;
        
        // Update optimized texture data
        PointLightDataOptimized *ld0 = &pointLightTexture[i];
        PointLightDataOptimized *ld1 = &pointLightTexture[i+1];
        PointLightDataOptimized *ld2 = &pointLightTexture[i+2];
        PointLightDataOptimized *ld3 = &pointLightTexture[i+3];
        
        // Pack data into optimized format with LOD
        ld0->positionRadius = l0->viewPos;
        ld0->colorDecayVisible = (Vec4){
            l0->color.x * l0->color.w,
            l0->color.y * l0->color.w,
            l0->color.z * l0->color.w,
            packLightParams(l0->decay, l0->visible && !culled0, l0->lodLevel)
        };
        
        ld1->positionRadius = l1->viewPos;
        ld1->colorDecayVisible = (Vec4){
            l1->color.x * l1->color.w,
            l1->color.y * l1->color.w,
            l1->color.z * l1->color.w,
            packLightParams(l1->decay, l1->visible && !culled1, l1->lodLevel)
        };
        
        ld2->positionRadius = l2->viewPos;
        ld2->colorDecayVisible = (Vec4){
            l2->color.x * l2->color.w,
            l2->color.y * l2->color.w,
            l2->color.z * l2->color.w,
            packLightParams(l2->decay, l2->visible && !culled2, l2->lodLevel)
        };
        
        ld3->positionRadius = l3->viewPos;
        ld3->colorDecayVisible = (Vec4){
            l3->color.x * l3->color.w,
            l3->color.y * l3->color.w,
            l3->color.z * l3->color.w,
            packLightParams(l3->decay, l3->visible && !culled3, l3->lodLevel)
        };
        
        l0->dirty = 0;
        l1->dirty = 0;
        l2->dirty = 0;
        l3->dirty = 0;
    }
    
    // Handle remaining lights
    for (; i < pointLightCount; i++) {
        PointLight *l = &pointLights[i];
        PointLightDataOptimized *ld = &pointLightTexture[i];
        
        // Process animation
        if (l->anim.flags != ANIM_NONE) {
            processPointLightAnimation(l, time);
        } else {
            l->worldPos = l->baseWorldPos;
        }
        
        // Transform to view space
        worldToView(l->worldPos.x, l->worldPos.y, l->worldPos.z, l->worldPos.w, &l->viewPos);
        
        // Calculate LOD level
        l->lodLevel = calculateLOD(l->viewPos.z, l->worldPos.w);
        
        // Visibility culling
        uint8_t culled = 0;
        if (l->viewPos.z > l->worldPos.w - viewNear || l->viewPos.z < -viewFar - l->worldPos.w) {
            culled = 1;
        }
        
        // Update texture data
        ld->positionRadius = l->viewPos;
        ld->colorDecayVisible = (Vec4){
            l->color.x * l->color.w,
            l->color.y * l->color.w,
            l->color.z * l->color.w,
            packLightParams(l->decay, l->visible && !culled, l->lodLevel)
        };
        
        l->dirty = 0;
    }
}

// Fast path for mass point lights without LOD
static void updatePointLightsFast(float time) {
    // Process in batches of 4 for SIMD efficiency (proper alignment)
    int i = 0;

    // Cache view matrix for SIMD
    v128_t e0v = wasm_f32x4_splat(e0);
    v128_t e1v = wasm_f32x4_splat(e1);
    v128_t e2v = wasm_f32x4_splat(e2);
    v128_t e4v = wasm_f32x4_splat(e4);
    v128_t e5v = wasm_f32x4_splat(e5);
    v128_t e6v = wasm_f32x4_splat(e6);
    v128_t e8v = wasm_f32x4_splat(e8);
    v128_t e9v = wasm_f32x4_splat(e9);
    v128_t e10v = wasm_f32x4_splat(e10);
    v128_t e12v = wasm_f32x4_splat(e12);
    v128_t e13v = wasm_f32x4_splat(e13);
    v128_t e14v = wasm_f32x4_splat(e14);

    for (; i + 3 < pointLightCount; i += 4) {
        // Process animations if needed
        if (hasAnimatedLights) {
            for (int j = 0; j < 4; j++) {
                PointLight *l = &pointLights[i + j];
                if (l->anim.flags & ANIM_CIRCULAR) {
                    float phase = time * l->anim.circular.speed;
                    l->worldPos.x = l->baseWorldPos.x + sinf(phase) * l->anim.circular.radius;
                    l->worldPos.z = l->baseWorldPos.z + cosf(phase) * l->anim.circular.radius;
                } else {
                    l->worldPos = l->baseWorldPos;
                }
            }
        }

        // Load world positions (4 lights at once)
        v128_t wx = wasm_f32x4_make(
            pointLights[i].worldPos.x,
            pointLights[i+1].worldPos.x,
            pointLights[i+2].worldPos.x,
            pointLights[i+3].worldPos.x
        );
        v128_t wy = wasm_f32x4_make(
            pointLights[i].worldPos.y,
            pointLights[i+1].worldPos.y,
            pointLights[i+2].worldPos.y,
            pointLights[i+3].worldPos.y
        );
        v128_t wz = wasm_f32x4_make(
            pointLights[i].worldPos.z,
            pointLights[i+1].worldPos.z,
            pointLights[i+2].worldPos.z,
            pointLights[i+3].worldPos.z
        );

        // Transform to view space using SIMD
        v128_t vx = wasm_f32x4_add(
            wasm_f32x4_add(wasm_f32x4_mul(e0v, wx), wasm_f32x4_mul(e4v, wy)),
            wasm_f32x4_add(wasm_f32x4_mul(e8v, wz), e12v)
        );
        v128_t vy = wasm_f32x4_add(
            wasm_f32x4_add(wasm_f32x4_mul(e1v, wx), wasm_f32x4_mul(e5v, wy)),
            wasm_f32x4_add(wasm_f32x4_mul(e9v, wz), e13v)
        );
        v128_t vz = wasm_f32x4_add(
            wasm_f32x4_add(wasm_f32x4_mul(e2v, wx), wasm_f32x4_mul(e6v, wy)),
            wasm_f32x4_add(wasm_f32x4_mul(e10v, wz), e14v)
        );

        // Extract and write results - must be unrolled for compile-time lane access
        PointLight *l0 = &pointLights[i];
        PointLight *l1 = &pointLights[i + 1];
        PointLight *l2 = &pointLights[i + 2];
        PointLight *l3 = &pointLights[i + 3];

        l0->viewPos.x = wasm_f32x4_extract_lane(vx, 0);
        l0->viewPos.y = wasm_f32x4_extract_lane(vy, 0);
        l0->viewPos.z = wasm_f32x4_extract_lane(vz, 0);
        l0->viewPos.w = l0->worldPos.w;

        l1->viewPos.x = wasm_f32x4_extract_lane(vx, 1);
        l1->viewPos.y = wasm_f32x4_extract_lane(vy, 1);
        l1->viewPos.z = wasm_f32x4_extract_lane(vz, 1);
        l1->viewPos.w = l1->worldPos.w;

        l2->viewPos.x = wasm_f32x4_extract_lane(vx, 2);
        l2->viewPos.y = wasm_f32x4_extract_lane(vy, 2);
        l2->viewPos.z = wasm_f32x4_extract_lane(vz, 2);
        l2->viewPos.w = l2->worldPos.w;

        l3->viewPos.x = wasm_f32x4_extract_lane(vx, 3);
        l3->viewPos.y = wasm_f32x4_extract_lane(vy, 3);
        l3->viewPos.z = wasm_f32x4_extract_lane(vz, 3);
        l3->viewPos.w = l3->worldPos.w;

        // Write to texture data
        PointLightDataOptimized *ld0 = &pointLightTexture[i];
        PointLightDataOptimized *ld1 = &pointLightTexture[i + 1];
        PointLightDataOptimized *ld2 = &pointLightTexture[i + 2];
        PointLightDataOptimized *ld3 = &pointLightTexture[i + 3];

        ld0->positionRadius = l0->viewPos;
        ld0->colorDecayVisible = (Vec4){l0->color.x * l0->color.w, l0->color.y * l0->color.w, l0->color.z * l0->color.w, 1.0f};

        ld1->positionRadius = l1->viewPos;
        ld1->colorDecayVisible = (Vec4){l1->color.x * l1->color.w, l1->color.y * l1->color.w, l1->color.z * l1->color.w, 1.0f};

        ld2->positionRadius = l2->viewPos;
        ld2->colorDecayVisible = (Vec4){l2->color.x * l2->color.w, l2->color.y * l2->color.w, l2->color.z * l2->color.w, 1.0f};

        ld3->positionRadius = l3->viewPos;
        ld3->colorDecayVisible = (Vec4){l3->color.x * l3->color.w, l3->color.y * l3->color.w, l3->color.z * l3->color.w, 1.0f};
    }

    // Handle remainder with scalar path
    for (; i < pointLightCount; i++) {
        PointLight *l = &pointLights[i];
        PointLightDataOptimized *ld = &pointLightTexture[i];

        if (hasAnimatedLights && (l->anim.flags & ANIM_CIRCULAR)) {
            float phase = time * l->anim.circular.speed;
            l->worldPos.x = l->baseWorldPos.x + sinf(phase) * l->anim.circular.radius;
            l->worldPos.z = l->baseWorldPos.z + cosf(phase) * l->anim.circular.radius;
        } else {
            l->worldPos = l->baseWorldPos;
        }

        worldToView(l->worldPos.x, l->worldPos.y, l->worldPos.z, l->worldPos.w, &l->viewPos);

        ld->positionRadius = l->viewPos;
        ld->colorDecayVisible = (Vec4){
            l->color.x * l->color.w,
            l->color.y * l->color.w,
            l->color.z * l->color.w,
            1.0f
        };
    }
}
#endif

// ──────────────────────────────────────────────────────────────
//                     GENERIC RADIX SORT
// ──────────────────────────────────────────────────────────────
// Generic radix sort that works with any light type
// Assumes morton code is at the same offset in all structs
#define RADIX_SORT_IMPL(TYPE, src_array, dst_array, count) \
    do { \
        static const int R = 256; \
        uint32_t hist[R]; \
        TYPE *src = src_array; \
        TYPE *dst = dst_array; \
        \
        for (int pass = 0, shift = 0; pass < 4; ++pass, shift += 8) { \
            memset(hist, 0, sizeof(hist)); \
            for (int i = 0; i < count; ++i) hist[(src[i].morton >> shift) & 0xFFu]++; \
            int sum = 0; \
            for (int i = 0; i < R; ++i) { int c = hist[i]; hist[i] = sum; sum += c; } \
            for (int i = 0; i < count; ++i) { \
                uint32_t b = (src[i].morton >> shift) & 0xFFu; \
                dst[hist[b]++] = src[i]; \
            } \
            TYPE *tmp = src; src = dst; dst = tmp; \
        } \
        if (src != src_array) memcpy(src_array, src, (count) * sizeof(TYPE)); \
    } while(0)

static void radixSortPointLights(int n) {
    RADIX_SORT_IMPL(PointLight, pointLights, pointLightsScratch, n);
}

static void radixSortSpotLights(int n) {
    RADIX_SORT_IMPL(SpotLight, spotLights, spotLightsScratch, n);
}

static void radixSortRectLights(int n) {
    RADIX_SORT_IMPL(RectLight, rectLights, rectLightsScratch, n);
}

// ──────────────────────────────────────────────────────────────
//                     INITIALISATION / CLEANUP
// ──────────────────────────────────────────────────────────────

EMSCRIPTEN_KEEPALIVE void init(int count) {
    const size_t pointBytes = sizeof(PointLight) * (size_t)count;
    const size_t spotBytes = sizeof(SpotLight) * (size_t)count;
    const size_t rectBytes = sizeof(RectLight) * (size_t)count;

    posix_memalign((void**)&cameraMatrix, 16, sizeof(Mat4));
    
    posix_memalign((void**)&pointLights, 16, pointBytes);
    posix_memalign((void**)&spotLights, 16, spotBytes);
    posix_memalign((void**)&rectLights, 16, rectBytes);
    
    posix_memalign((void**)&pointLightsScratch, 16, pointBytes);
    posix_memalign((void**)&spotLightsScratch, 16, spotBytes);
    posix_memalign((void**)&rectLightsScratch, 16, rectBytes);
    
    posix_memalign((void**)&pointLightTexture, 16, sizeof(PointLightDataOptimized) * (size_t)count);
    posix_memalign((void**)&spotLightTexture, 16, sizeof(SpotLightData) * (size_t)count);
    posix_memalign((void**)&rectLightTexture, 16, sizeof(RectLightData) * (size_t)count);

    pointLightCount = 0;
    spotLightCount = 0;
    rectLightCount = 0;
    maxLights = count;
    needsSort = 0;
    hasAnimatedLights = 0;
    hasPointLights = 0;
    hasSpotLights = 0;
    hasRectLights = 0;
}

EMSCRIPTEN_KEEPALIVE void cleanup(void) {
    free(cameraMatrix);
    free(pointLightsScratch);
    free(spotLightsScratch);
    free(rectLightsScratch);
    free(pointLights);
    free(spotLights);
    free(rectLights);
    free(pointLightTexture);
    free(spotLightTexture);
    free(rectLightTexture);
    
    cameraMatrix = NULL;
    pointLights = NULL;
    spotLights = NULL;
    rectLights = NULL;
    pointLightTexture = NULL;
    spotLightTexture = NULL;
    rectLightTexture = NULL;
    
    pointLightCount = spotLightCount = rectLightCount = maxLights = 0;
    needsSort = hasAnimatedLights = 0;
}

// ──────────────────────────────────────────────────────────────
//                   VIEW FRUSTUM SETTINGS
// ──────────────────────────────────────────────────────────────
EMSCRIPTEN_KEEPALIVE void setViewFrustum(float near, float far) {
    viewNear = near;
    viewFar = far;
}

// ──────────────────────────────────────────────────────────────
//                   LOD SETTINGS
// ──────────────────────────────────────────────────────────────
EMSCRIPTEN_KEEPALIVE void setLODBias(float bias) {
    lodBias = bias;
}

EMSCRIPTEN_KEEPALIVE float getLODBias(void) {
    return lodBias;
}

// ──────────────────────────────────────────────────────────────
//                   LIGHT CREATION
// ──────────────────────────────────────────────────────────────
EMSCRIPTEN_KEEPALIVE int add(float px, float py, float pz, float radius,
                             float r, float g, float b,
                             float decay, float speed, float animRadius, float intensity) {
    if (pointLightCount >= maxLights) return -1;
    
    PointLight *l = &pointLights[pointLightCount];
    l->baseWorldPos = (Vec4){px, py, pz, radius};
    l->animOffset = (Vec4){0, 0, 0, 0};
    l->worldPos = l->baseWorldPos;
    l->baseColor = (Vec4){r, g, b, intensity};
    l->color = l->baseColor;
    l->decay = decay;
    l->morton = computeMorton(px, pz);
    l->dirty = DIRTY_ALL;
    l->visible = 1;
    l->lodLevel = LOD_FULL;
    l->castsShadow = 0;           // Default: no shadows
    l->shadowIntensity = 0.3f;    // Default: moderate shadow darkness

    // Initialize animation
    l->anim.flags = ANIM_NONE;
    if (speed != 0.0f) {
        l->anim.flags |= ANIM_CIRCULAR;
        l->anim.circular.speed = speed;
        l->anim.circular.radius = animRadius;
        hasAnimatedLights = 1;
    }
    
    needsSort = 1;
    hasPointLights = 1;
    
    return pointLightCount++;
}

// Fast add for mass lights
EMSCRIPTEN_KEEPALIVE int addFast(float px, float py, float pz, float radius,
                                 float r, float g, float b, float intensity) {
    if (pointLightCount >= maxLights) return -1;
    
    PointLight *l = &pointLights[pointLightCount];
    l->baseWorldPos = (Vec4){px, py, pz, radius};
    l->worldPos = l->baseWorldPos;
    l->baseColor = (Vec4){r, g, b, intensity};
    l->color = l->baseColor;
    l->decay = 1.0f; // Fixed decay for fast path
    l->morton = computeMorton(px, pz);
    l->visible = 1;
    l->lodLevel = LOD_FULL;
    l->castsShadow = 0;           // Default: no shadows
    l->shadowIntensity = 0.3f;    // Default: moderate shadow darkness
    l->anim.flags = ANIM_NONE;
    
    needsSort = 1;
    hasPointLights = 1;
    
    return pointLightCount++;
}

// New function to add point light with full animation params
EMSCRIPTEN_KEEPALIVE int addPointWithAnimation(
    float px, float py, float pz, float radius,
    float r, float g, float b, float intensity, float decay,
    uint32_t animFlags,
    // Circular params
    float circSpeed, float circRadius,
    // Linear params
    float targetX, float targetY, float targetZ, float duration, float delay, uint8_t linearMode,
    // Wave params
    float waveAxisX, float waveAxisY, float waveAxisZ, float waveSpeed, float waveAmplitude, float wavePhase,
    // Flicker params
    float flickerSpeed, float flickerIntensity, float flickerSeed,
    // Pulse params
    float pulseSpeed, float pulseAmount, uint8_t pulseTarget
) {
    if (pointLightCount >= maxLights) return -1;
    
    PointLight *l = &pointLights[pointLightCount];
    l->baseWorldPos = (Vec4){px, py, pz, radius};
    l->animOffset = (Vec4){0, 0, 0, 0};
    l->worldPos = l->baseWorldPos;
    l->baseColor = (Vec4){r, g, b, intensity};
    l->color = l->baseColor;
    l->decay = decay;
    l->morton = computeMorton(px, pz);
    l->dirty = DIRTY_ALL;
    l->visible = 1;
    l->lodLevel = LOD_FULL;
    
    // Setup animation
    l->anim.flags = animFlags;
    
    if (animFlags & ANIM_CIRCULAR) {
        l->anim.circular.speed = circSpeed;
        l->anim.circular.radius = circRadius;
        hasAnimatedLights = 1;
    }
    
    if (animFlags & ANIM_LINEAR) {
        l->anim.linear.targetPos = (Vec4){targetX, targetY, targetZ, 0};
        l->anim.linear.duration = duration;
        l->anim.linear.delay = delay;
        l->anim.linear.mode = linearMode;
        hasAnimatedLights = 1;
    }
    
    if (animFlags & ANIM_WAVE) {
        l->anim.wave.axis = (Vec4){waveAxisX, waveAxisY, waveAxisZ, 0};
        // Normalize axis
        float len = sqrtf(waveAxisX*waveAxisX + waveAxisY*waveAxisY + waveAxisZ*waveAxisZ);
        if (len > 0) {
            l->anim.wave.axis.x /= len;
            l->anim.wave.axis.y /= len;
            l->anim.wave.axis.z /= len;
        }
        l->anim.wave.speed = waveSpeed;
        l->anim.wave.amplitude = waveAmplitude;
        l->anim.wave.phase = wavePhase;
        hasAnimatedLights = 1;
    }
    
    if (animFlags & ANIM_FLICKER) {
        l->anim.flicker.speed = flickerSpeed;
        l->anim.flicker.intensity = flickerIntensity;
        l->anim.flicker.seed = flickerSeed;
        hasAnimatedLights = 1;
    }
    
    if (animFlags & ANIM_PULSE) {
        l->anim.pulse.speed = pulseSpeed;
        l->anim.pulse.amount = pulseAmount;
        l->anim.pulse.target = pulseTarget;
        hasAnimatedLights = 1;
    }
    
    needsSort = 1;
    hasPointLights = 1;
    
    return pointLightCount++;
}

EMSCRIPTEN_KEEPALIVE int addSpot(float px, float py, float pz, float radius,
                                 float r, float g, float b,
                                 float dx, float dy, float dz,
                                 float angle, float penumbra,
                                 float decay, float intensity) {
    if (spotLightCount >= maxLights) return -1;
    
    SpotLight *l = &spotLights[spotLightCount];
    l->baseWorldPos = (Vec4){px, py, pz, radius};
    l->animOffset = (Vec4){0, 0, 0, 0};
    l->worldPos = l->baseWorldPos;
    l->color = (Vec4){r, g, b, intensity};
    
    float len = sqrtf(dx*dx + dy*dy + dz*dz);
    float inv = len > 0.f ? 1.f/len : 0.f;
    l->direction = (Vec4){dx*inv, dy*inv, dz*inv, 0.f};
    l->baseDir = l->direction;
    
    l->decay = decay;
    l->angle = angle;
    l->penumbra = penumbra;
    l->morton = computeMorton(px, pz);
    l->dirty = DIRTY_ALL;
    l->visible = 1;
    l->lodLevel = LOD_FULL;
    l->castsShadow = 0;           // Default: no shadows
    l->shadowIntensity = 0.3f;    // Default: moderate shadow darkness
    l->anim.flags = ANIM_NONE;
    
    needsSort = 1;
    hasSpotLights = 1;
    
    return spotLightCount++;
}

// New function for spot light with animation
EMSCRIPTEN_KEEPALIVE int addSpotWithAnimation(
    float px, float py, float pz, float radius,
    float r, float g, float b,
    float dx, float dy, float dz,
    float angle, float penumbra,
    float decay, float intensity,
    uint32_t animFlags,
    // Linear params
    float targetX, float targetY, float targetZ, float duration, float delay, uint8_t linearMode,
    // Rotation params
    float rotAxisX, float rotAxisY, float rotAxisZ, float rotSpeed, float rotAngle, uint8_t rotMode,
    // Flicker params
    float flickerSpeed, float flickerIntensity, float flickerSeed,
    // Pulse params
    float pulseSpeed, float pulseAmount, uint8_t pulseTarget
) {
    if (spotLightCount >= maxLights) return -1;
    
    SpotLight *l = &spotLights[spotLightCount];
    l->baseWorldPos = (Vec4){px, py, pz, radius};
    l->animOffset = (Vec4){0, 0, 0, 0};
    l->worldPos = l->baseWorldPos;
    l->color = (Vec4){r, g, b, intensity};
    
    float len = sqrtf(dx*dx + dy*dy + dz*dz);
    float inv = len > 0.f ? 1.f/len : 0.f;
    l->direction = (Vec4){dx*inv, dy*inv, dz*inv, 0.f};
    l->baseDir = l->direction;
    
    l->decay = decay;
    l->angle = angle;
    l->penumbra = penumbra;
    l->morton = computeMorton(px, pz);
    l->dirty = DIRTY_ALL;
    l->visible = 1;
    l->lodLevel = LOD_FULL;
    
    // Setup animation
    l->anim.flags = animFlags;
    
    if (animFlags & ANIM_LINEAR) {
        l->anim.linear.targetPos = (Vec4){targetX, targetY, targetZ, 0};
        l->anim.linear.duration = duration;
        l->anim.linear.delay = delay;
        l->anim.linear.mode = linearMode;
        hasAnimatedLights = 1;
    }
    
    if (animFlags & ANIM_ROTATE) {
        l->anim.rotation.axis = (Vec4){rotAxisX, rotAxisY, rotAxisZ, 0};
        // Normalize axis
        len = sqrtf(rotAxisX*rotAxisX + rotAxisY*rotAxisY + rotAxisZ*rotAxisZ);
        if (len > 0) {
            l->anim.rotation.axis.x /= len;
            l->anim.rotation.axis.y /= len;
            l->anim.rotation.axis.z /= len;
        }
        l->anim.rotation.speed = rotSpeed;
        l->anim.rotation.angle = rotAngle;
        l->anim.rotation.mode = rotMode;
        hasAnimatedLights = 1;
    }
    
    if (animFlags & ANIM_FLICKER) {
        l->anim.flicker.speed = flickerSpeed;
        l->anim.flicker.intensity = flickerIntensity;
        l->anim.flicker.seed = flickerSeed;
        hasAnimatedLights = 1;
    }
    
    if (animFlags & ANIM_PULSE) {
        l->anim.pulse.speed = pulseSpeed;
        l->anim.pulse.amount = pulseAmount;
        l->anim.pulse.target = pulseTarget;
        hasAnimatedLights = 1;
    }
    
    needsSort = 1;
    hasSpotLights = 1;
    
    return spotLightCount++;
}

EMSCRIPTEN_KEEPALIVE int addRect(float px, float py, float pz,
                                 float width, float height,
                                 float nx, float ny, float nz,
                                 float r, float g, float b,
                                 float intensity, float decay, float radius) {
    if (rectLightCount >= maxLights) return -1;
    
    RectLight *l = &rectLights[rectLightCount];
    l->baseWorldPos = (Vec4){px, py, pz, radius};
    l->animOffset = (Vec4){0, 0, 0, 0};
    l->worldPos = l->baseWorldPos;
    l->color = (Vec4){r, g, b, intensity};
    l->size = (Vec4){width, height, 0.f, 0.f};
    
    float len = sqrtf(nx*nx + ny*ny + nz*nz);
    float inv = len > 0.f ? 1.f/len : 0.f;
    l->normal = (Vec4){nx*inv, ny*inv, nz*inv, 0.f};
    l->baseNormal = l->normal;

    // Initialize tangent and bitangent basis vectors
    buildOrthonormalBasis(&l->normal, &l->tangent, &l->bitangent);
    l->baseTangent = l->tangent;
    l->baseBitangent = l->bitangent;

    l->decay = decay;
    l->morton = computeMorton(px, pz);
    l->dirty = DIRTY_ALL;
    l->visible = 1;
    l->lodLevel = LOD_FULL;
    l->castsShadow = 0;           // Default: no shadows
    l->shadowIntensity = 0.3f;    // Default: moderate shadow darkness
    l->anim.flags = ANIM_NONE;

    needsSort = 1;
    hasRectLights = 1;
    
    return rectLightCount++;
}

// New function for rect light with animation
EMSCRIPTEN_KEEPALIVE int addRectWithAnimation(
    float px, float py, float pz,
    float width, float height,
    float nx, float ny, float nz,
    float r, float g, float b,
    float intensity, float decay, float radius,
    uint32_t animFlags,
    // Linear params
    float targetX, float targetY, float targetZ, float duration, float delay, uint8_t linearMode,
    // Rotation params
    float rotAxisX, float rotAxisY, float rotAxisZ, float rotSpeed, float rotAngle, uint8_t rotMode,
    // Flicker params
    float flickerSpeed, float flickerIntensity, float flickerSeed,
    // Pulse params
    float pulseSpeed, float pulseAmount, uint8_t pulseTarget
) {
    if (rectLightCount >= maxLights) return -1;
    
    RectLight *l = &rectLights[rectLightCount];
    l->baseWorldPos = (Vec4){px, py, pz, radius};
    l->animOffset = (Vec4){0, 0, 0, 0};
    l->worldPos = l->baseWorldPos;
    l->color = (Vec4){r, g, b, intensity};
    l->size = (Vec4){width, height, 0.f, 0.f};
    
    float len = sqrtf(nx*nx + ny*ny + nz*nz);
    float inv = len > 0.f ? 1.f/len : 0.f;
    l->normal = (Vec4){nx*inv, ny*inv, nz*inv, 0.f};
    l->baseNormal = l->normal;

    // Initialize tangent and bitangent basis vectors
    buildOrthonormalBasis(&l->normal, &l->tangent, &l->bitangent);
    l->baseTangent = l->tangent;
    l->baseBitangent = l->bitangent;

    l->decay = decay;
    l->morton = computeMorton(px, pz);
    l->dirty = DIRTY_ALL;
    l->visible = 1;
    l->lodLevel = LOD_FULL;
    
    // Setup animation
    l->anim.flags = animFlags;
    
    if (animFlags & ANIM_LINEAR) {
        l->anim.linear.targetPos = (Vec4){targetX, targetY, targetZ, 0};
        l->anim.linear.duration = duration;
        l->anim.linear.delay = delay;
        l->anim.linear.mode = linearMode;
        hasAnimatedLights = 1;
    }
    
    if (animFlags & ANIM_ROTATE) {
        l->anim.rotation.axis = (Vec4){rotAxisX, rotAxisY, rotAxisZ, 0};
        // Normalize axis
        len = sqrtf(rotAxisX*rotAxisX + rotAxisY*rotAxisY + rotAxisZ*rotAxisZ);
        if (len > 0) {
            l->anim.rotation.axis.x /= len;
            l->anim.rotation.axis.y /= len;
            l->anim.rotation.axis.z /= len;
        }
        l->anim.rotation.speed = rotSpeed;
        l->anim.rotation.angle = rotAngle;
        l->anim.rotation.mode = rotMode;
        hasAnimatedLights = 1;
    }
    
    if (animFlags & ANIM_FLICKER) {
        l->anim.flicker.speed = flickerSpeed;
        l->anim.flicker.intensity = flickerIntensity;
        l->anim.flicker.seed = flickerSeed;
        hasAnimatedLights = 1;
    }
    
    if (animFlags & ANIM_PULSE) {
        l->anim.pulse.speed = pulseSpeed;
        l->anim.pulse.amount = pulseAmount;
        l->anim.pulse.target = pulseTarget;
        hasAnimatedLights = 1;
    }
    
    needsSort = 1;
    hasRectLights = 1;
    
    return rectLightCount++;
}

// ──────────────────────────────────────────────────────────────
//                   BULK LIGHT INITIALIZATION
// ──────────────────────────────────────────────────────────────
// Bulk add point lights from arrays (eliminates JS->WASM call overhead)
// Arrays are passed as pointers to WASM memory
EMSCRIPTEN_KEEPALIVE int bulkAddPointLights(
    int count,
    float* positions,      // x,y,z,radius per light (stride 4)
    float* colors,         // r,g,b,intensity per light (stride 4)
    float* decays,         // decay per light
    uint32_t* animFlags,   // animation flags per light
    float* animParams      // all anim params packed: [circular(2), wave(6), flicker(3), pulse(3)] = 14 floats per light
) {
    if (pointLightCount + count > maxLights) {
        count = maxLights - pointLightCount; // Clamp to available space
    }

    int added = 0;
    for (int i = 0; i < count; i++) {
        PointLight *l = &pointLights[pointLightCount + i];

        // Position and radius
        int pi = i * 4;
        l->baseWorldPos = (Vec4){positions[pi], positions[pi+1], positions[pi+2], positions[pi+3]};
        l->animOffset = (Vec4){0, 0, 0, 0};
        l->worldPos = l->baseWorldPos;

        // Color and intensity
        l->baseColor = (Vec4){colors[pi], colors[pi+1], colors[pi+2], colors[pi+3]};
        l->color = l->baseColor;

        // Decay
        l->decay = decays[i];

        // Morton code from base position
        l->morton = computeMorton(positions[pi], positions[pi+2]);

        // Initialize state
        l->dirty = DIRTY_ALL;
        l->visible = 1;
        l->lodLevel = LOD_FULL;

        // Animation - packed format: [circular(2), wave(6), flicker(3), pulse(3)]
        l->anim.flags = animFlags ? animFlags[i] : ANIM_NONE;

        if (l->anim.flags != ANIM_NONE) {
            int ai = i * 14; // 14 floats per light for all anim types

            if (l->anim.flags & ANIM_CIRCULAR) {
                l->anim.circular.speed = animParams[ai];
                l->anim.circular.radius = animParams[ai+1];
                hasAnimatedLights = 1;
            }

            if (l->anim.flags & ANIM_WAVE) {
                l->anim.wave.axis.x = animParams[ai+2];
                l->anim.wave.axis.y = animParams[ai+3];
                l->anim.wave.axis.z = animParams[ai+4];

                // Normalize axis
                float len = sqrtf(l->anim.wave.axis.x * l->anim.wave.axis.x +
                                l->anim.wave.axis.y * l->anim.wave.axis.y +
                                l->anim.wave.axis.z * l->anim.wave.axis.z);
                if (len > 0) {
                    l->anim.wave.axis.x /= len;
                    l->anim.wave.axis.y /= len;
                    l->anim.wave.axis.z /= len;
                }

                l->anim.wave.speed = animParams[ai+5];
                l->anim.wave.amplitude = animParams[ai+6];
                l->anim.wave.phase = animParams[ai+7];
                hasAnimatedLights = 1;
            }

            if (l->anim.flags & ANIM_FLICKER) {
                l->anim.flicker.speed = animParams[ai+8];
                l->anim.flicker.intensity = animParams[ai+9];
                l->anim.flicker.seed = animParams[ai+10];
                hasAnimatedLights = 1;
            }

            if (l->anim.flags & ANIM_PULSE) {
                l->anim.pulse.speed = animParams[ai+11];
                l->anim.pulse.amount = animParams[ai+12];
                l->anim.pulse.target = (uint8_t)animParams[ai+13];
                hasAnimatedLights = 1;
            }
        }

        added++;
    }

    pointLightCount += added;
    needsSort = 1;
    hasPointLights = 1;

    return added;
}

// Bulk add mixed light types (point, spot, rect) with single WASM call
// Memory layout per light:
// - type: uint8 (0=point, 1=spot, 2=rect)
// - position: float[4] (x,y,z,radius)
// - color: float[4] (r,g,b,intensity)
// - decay: float
// - animFlags: uint32
// - animParams: float[14] (shared: circular[2], wave[6], flicker[3], pulse[3])
// - spotParams: float[6] (dirX, dirY, dirZ, angle, penumbra, padding) - only for spot
// - rectParams: float[6] (width, height, normalX, normalY, normalZ, padding) - only for rect
EMSCRIPTEN_KEEPALIVE int bulkAddLights(
    int count,
    uint8_t* types,        // Light type per light (0=point, 1=spot, 2=rect)
    float* positions,      // x,y,z,radius per light (stride 4)
    float* colors,         // r,g,b,intensity per light (stride 4)
    float* decays,         // decay per light
    uint32_t* animFlags,   // animation flags per light
    float* animParams,     // all anim params packed: [circular(2), wave(6), flicker(3), pulse(3)] = 14 floats per light
    float* spotParams,     // spot-specific params: [dirX,dirY,dirZ,angle,penumbra,pad] = 6 floats per spot light
    float* rectParams      // rect-specific params: [width,height,normalX,normalY,normalZ,pad] = 6 floats per rect light
) {
    int pointAdded = 0, spotAdded = 0, rectAdded = 0;
    int spotIdx = 0, rectIdx = 0;

    for (int i = 0; i < count; i++) {
        uint8_t type = types[i];
        int pi = i * 4;  // Position index

        if (type == 0) {  // Point light
            if (pointLightCount >= maxLights) continue;

            PointLight *l = &pointLights[pointLightCount];

            // Position and radius
            l->baseWorldPos = (Vec4){positions[pi], positions[pi+1], positions[pi+2], positions[pi+3]};
            l->animOffset = (Vec4){0, 0, 0, 0};
            l->worldPos = l->baseWorldPos;

            // Color and intensity
            l->baseColor = (Vec4){colors[pi], colors[pi+1], colors[pi+2], colors[pi+3]};
            l->color = l->baseColor;

            // Decay
            l->decay = decays[i];

            // Morton code
            l->morton = computeMorton(positions[pi], positions[pi+2]);

            // State
            l->dirty = DIRTY_ALL;
            l->visible = 1;
            l->lodLevel = LOD_FULL;

            // Animation
            l->anim.flags = animFlags ? animFlags[i] : ANIM_NONE;
            if (l->anim.flags != ANIM_NONE) {
                int ai = i * 14;
                if (l->anim.flags & ANIM_CIRCULAR) {
                    l->anim.circular.speed = animParams[ai];
                    l->anim.circular.radius = animParams[ai+1];
                    hasAnimatedLights = 1;
                }
                if (l->anim.flags & ANIM_WAVE) {
                    l->anim.wave.axis.x = animParams[ai+2];
                    l->anim.wave.axis.y = animParams[ai+3];
                    l->anim.wave.axis.z = animParams[ai+4];
                    float len = sqrtf(l->anim.wave.axis.x * l->anim.wave.axis.x +
                                    l->anim.wave.axis.y * l->anim.wave.axis.y +
                                    l->anim.wave.axis.z * l->anim.wave.axis.z);
                    if (len > 0) {
                        l->anim.wave.axis.x /= len;
                        l->anim.wave.axis.y /= len;
                        l->anim.wave.axis.z /= len;
                    }
                    l->anim.wave.speed = animParams[ai+5];
                    l->anim.wave.amplitude = animParams[ai+6];
                    l->anim.wave.phase = animParams[ai+7];
                    hasAnimatedLights = 1;
                }
                if (l->anim.flags & ANIM_FLICKER) {
                    l->anim.flicker.speed = animParams[ai+8];
                    l->anim.flicker.intensity = animParams[ai+9];
                    l->anim.flicker.seed = animParams[ai+10];
                    hasAnimatedLights = 1;
                }
                if (l->anim.flags & ANIM_PULSE) {
                    l->anim.pulse.speed = animParams[ai+11];
                    l->anim.pulse.amount = animParams[ai+12];
                    l->anim.pulse.target = (uint8_t)animParams[ai+13];
                    hasAnimatedLights = 1;
                }
            }

            pointLightCount++;
            pointAdded++;
            hasPointLights = 1;

        } else if (type == 1) {  // Spot light
            if (spotLightCount >= maxLights) continue;

            SpotLight *l = &spotLights[spotLightCount];
            int si = spotIdx * 6;  // Spot params index

            // Position and radius
            l->baseWorldPos = (Vec4){positions[pi], positions[pi+1], positions[pi+2], positions[pi+3]};
            l->animOffset = (Vec4){0, 0, 0, 0};
            l->worldPos = l->baseWorldPos;

            // Color and intensity
            l->color = (Vec4){colors[pi], colors[pi+1], colors[pi+2], colors[pi+3]};

            // Direction, angle, penumbra
            l->direction = (Vec4){spotParams[si], spotParams[si+1], spotParams[si+2], 0};
            l->baseDir = l->direction;
            l->angle = spotParams[si+3];
            l->penumbra = spotParams[si+4];

            // Decay
            l->decay = decays[i];

            // Morton code
            l->morton = computeMorton(positions[pi], positions[pi+2]);

            // State
            l->dirty = DIRTY_ALL;
            l->visible = 1;
            l->lodLevel = LOD_FULL;

            // Animation
            l->anim.flags = animFlags ? animFlags[i] : ANIM_NONE;
            if (l->anim.flags != ANIM_NONE) {
                int ai = i * 14;
                if (l->anim.flags & ANIM_LINEAR) {
                    l->anim.linear.targetPos.x = animParams[ai];
                    l->anim.linear.targetPos.y = animParams[ai+1];
                    l->anim.linear.targetPos.z = animParams[ai+2];
                    l->anim.linear.duration = animParams[ai+3];
                    l->anim.linear.delay = animParams[ai+4];
                    l->anim.linear.mode = (uint8_t)animParams[ai+5];
                    hasAnimatedLights = 1;
                }
                if (l->anim.flags & ANIM_PULSE) {
                    l->anim.pulse.speed = animParams[ai+11];
                    l->anim.pulse.amount = animParams[ai+12];
                    l->anim.pulse.target = (uint8_t)animParams[ai+13];
                    hasAnimatedLights = 1;
                }
                if (l->anim.flags & ANIM_ROTATE) {
                    l->anim.rotation.axis.x = animParams[ai+6];
                    l->anim.rotation.axis.y = animParams[ai+7];
                    l->anim.rotation.axis.z = animParams[ai+8];
                    l->anim.rotation.speed = animParams[ai+9];
                    l->anim.rotation.angle = animParams[ai+10];
                    l->anim.rotation.mode = (uint8_t)animParams[ai+5];  // Reuse linear.mode slot
                    hasAnimatedLights = 1;
                }
            }

            spotLightCount++;
            spotAdded++;
            spotIdx++;
            hasSpotLights = 1;

        } else if (type == 2) {  // Rect light
            if (rectLightCount >= maxLights) continue;

            RectLight *l = &rectLights[rectLightCount];
            int ri = rectIdx * 6;  // Rect params index

            // Position and radius
            l->baseWorldPos = (Vec4){positions[pi], positions[pi+1], positions[pi+2], positions[pi+3]};
            l->animOffset = (Vec4){0, 0, 0, 0};
            l->worldPos = l->baseWorldPos;

            // Color and intensity
            l->color = (Vec4){colors[pi], colors[pi+1], colors[pi+2], colors[pi+3]};

            // Size and normal
            l->size = (Vec4){rectParams[ri], rectParams[ri+1], 0, 0};

            // Normalize normal vector
            float nx = rectParams[ri+2];
            float ny = rectParams[ri+3];
            float nz = rectParams[ri+4];
            float nlen = sqrtf(nx*nx + ny*ny + nz*nz);
            float ninv = nlen > 0.f ? 1.f/nlen : 0.f;
            l->normal = (Vec4){nx*ninv, ny*ninv, nz*ninv, 0.f};
            l->baseNormal = l->normal;

            // Build orthonormal basis (tangent/bitangent) from normal
            buildOrthonormalBasis(&l->normal, &l->tangent, &l->bitangent);
            l->baseTangent = l->tangent;
            l->baseBitangent = l->bitangent;

            // Decay
            l->decay = decays[i];

            // Morton code
            l->morton = computeMorton(positions[pi], positions[pi+2]);

            // State
            l->dirty = DIRTY_ALL;
            l->visible = 1;
            l->lodLevel = LOD_FULL;

            // Animation
            l->anim.flags = animFlags ? animFlags[i] : ANIM_NONE;
            if (l->anim.flags != ANIM_NONE) {
                int ai = i * 14;
                if (l->anim.flags & ANIM_LINEAR) {
                    l->anim.linear.targetPos.x = animParams[ai];
                    l->anim.linear.targetPos.y = animParams[ai+1];
                    l->anim.linear.targetPos.z = animParams[ai+2];
                    l->anim.linear.duration = animParams[ai+3];
                    l->anim.linear.delay = animParams[ai+4];
                    l->anim.linear.mode = (uint8_t)animParams[ai+5];
                    hasAnimatedLights = 1;
                }
                if (l->anim.flags & ANIM_PULSE) {
                    l->anim.pulse.speed = animParams[ai+11];
                    l->anim.pulse.amount = animParams[ai+12];
                    l->anim.pulse.target = (uint8_t)animParams[ai+13];
                    hasAnimatedLights = 1;
                }
                if (l->anim.flags & ANIM_ROTATE) {
                    l->anim.rotation.axis.x = animParams[ai+6];
                    l->anim.rotation.axis.y = animParams[ai+7];
                    l->anim.rotation.axis.z = animParams[ai+8];
                    l->anim.rotation.speed = animParams[ai+9];
                    l->anim.rotation.angle = animParams[ai+10];
                    l->anim.rotation.mode = (uint8_t)animParams[ai+5];
                    hasAnimatedLights = 1;
                }
            }

            rectLightCount++;
            rectAdded++;
            rectIdx++;
            hasRectLights = 1;
        }
    }

    needsSort = 1;
    return pointAdded + spotAdded + rectAdded;
}

// ──────────────────────────────────────────────────────────────
//                   LIGHT REMOVAL
// ──────────────────────────────────────────────────────────────
EMSCRIPTEN_KEEPALIVE void removePointLight(int idx) {
    if (idx >= 0 && idx < pointLightCount) {
        if (pointLights[idx].anim.flags != ANIM_NONE) {
            // Check if this was the last animated light
            hasAnimatedLights = 0;
            for (int i = 0; i < pointLightCount; i++) {
                if (i != idx && pointLights[i].anim.flags != ANIM_NONE) {
                    hasAnimatedLights = 1;
                    break;
                }
            }
            if (!hasAnimatedLights) {
                for (int i = 0; i < spotLightCount; i++) {
                    if (spotLights[i].anim.flags != ANIM_NONE) {
                        hasAnimatedLights = 1;
                        break;
                    }
                }
            }
            if (!hasAnimatedLights) {
                for (int i = 0; i < rectLightCount; i++) {
                    if (rectLights[i].anim.flags != ANIM_NONE) {
                        hasAnimatedLights = 1;
                        break;
                    }
                }
            }
        }
        
        memmove(&pointLights[idx], &pointLights[idx+1], 
                (size_t)(pointLightCount - idx - 1) * sizeof(PointLight));
        pointLightCount--;
        needsSort = 1;
        hasPointLights = pointLightCount > 0;
    }
}

EMSCRIPTEN_KEEPALIVE void removeSpotLight(int idx) {
    if (idx >= 0 && idx < spotLightCount) {
        if (spotLights[idx].anim.flags != ANIM_NONE) {
            // Check if this was the last animated light
            hasAnimatedLights = 0;
            for (int i = 0; i < spotLightCount; i++) {
                if (i != idx && spotLights[i].anim.flags != ANIM_NONE) {
                    hasAnimatedLights = 1;
                    break;
                }
            }
            if (!hasAnimatedLights) {
                for (int i = 0; i < pointLightCount; i++) {
                    if (pointLights[i].anim.flags != ANIM_NONE) {
                        hasAnimatedLights = 1;
                        break;
                    }
                }
            }
            if (!hasAnimatedLights) {
                for (int i = 0; i < rectLightCount; i++) {
                    if (rectLights[i].anim.flags != ANIM_NONE) {
                        hasAnimatedLights = 1;
                        break;
                    }
                }
            }
        }
        
        memmove(&spotLights[idx], &spotLights[idx+1], 
                (size_t)(spotLightCount - idx - 1) * sizeof(SpotLight));
        spotLightCount--;
        needsSort = 1;
        hasSpotLights = spotLightCount > 0;
    }
}

EMSCRIPTEN_KEEPALIVE void removeRectLight(int idx) {
    if (idx >= 0 && idx < rectLightCount) {
        if (rectLights[idx].anim.flags != ANIM_NONE) {
            // Check if this was the last animated light
            hasAnimatedLights = 0;
            for (int i = 0; i < rectLightCount; i++) {
                if (i != idx && rectLights[i].anim.flags != ANIM_NONE) {
                    hasAnimatedLights = 1;
                    break;
                }
            }
            if (!hasAnimatedLights) {
                for (int i = 0; i < pointLightCount; i++) {
                    if (pointLights[i].anim.flags != ANIM_NONE) {
                        hasAnimatedLights = 1;
                        break;
                    }
                }
            }
            if (!hasAnimatedLights) {
                for (int i = 0; i < spotLightCount; i++) {
                    if (spotLights[i].anim.flags != ANIM_NONE) {
                        hasAnimatedLights = 1;
                        break;
                    }
                }
            }
        }
        
        memmove(&rectLights[idx], &rectLights[idx+1], 
                (size_t)(rectLightCount - idx - 1) * sizeof(RectLight));
        rectLightCount--;
        needsSort = 1;
        hasRectLights = rectLightCount > 0;
    }
}

// ──────────────────────────────────────────────────────────────
//                            SORT
// ──────────────────────────────────────────────────────────────
EMSCRIPTEN_KEEPALIVE void sort(void) {
    // Only sort during initialization or when base positions change
    if (needsSort) {
        if (pointLightCount > 1) radixSortPointLights(pointLightCount);
        if (spotLightCount > 1) radixSortSpotLights(spotLightCount);
        if (rectLightCount > 1) radixSortRectLights(rectLightCount);
        needsSort = 0;
    }
}

// ──────────────────────────────────────────────────────────────
//                   UPDATE FUNCTIONS WITH FAST PATHS
// ──────────────────────────────────────────────────────────────
EMSCRIPTEN_KEEPALIVE int update(float time) {
    // Cache view matrix elements
    float *e = cameraMatrix->te;
    e0 = e[0];  e1 = e[1];  e2 = e[2];
    e4 = e[4];  e5 = e[5];  e6 = e[6];
    e8 = e[8];  e9 = e[9];  e10= e[10];
    e12= e[12]; e13= e[13]; e14= e[14];

    int animated = 0;

    // Fast path: Only point lights
    if (hasPointLights && !hasSpotLights && !hasRectLights) {
        #ifdef __wasm_simd128__
        updatePointLightsSIMD(time);
        #else
        for (int i = 0; i < pointLightCount; i++) {
            PointLight *l = &pointLights[i];
            PointLightDataOptimized *ld = &pointLightTexture[i];
            
            // Process animation
            if (l->anim.flags != ANIM_NONE) {
                processPointLightAnimation(l, time);
                animated = 1;
            } else {
                l->worldPos = l->baseWorldPos;
            }
            
            // Transform to view space
            worldToView(l->worldPos.x, l->worldPos.y, l->worldPos.z, l->worldPos.w, &l->viewPos);
            
            // Calculate LOD level
            l->lodLevel = calculateLOD(l->viewPos.z, l->worldPos.w);
            
            // Visibility culling
            uint8_t culled = 0;
            if (l->viewPos.z > l->worldPos.w - viewNear || l->viewPos.z < -viewFar - l->worldPos.w) {
                culled = 1;
            }
            
            // Update texture data
            ld->positionRadius = l->viewPos;
            ld->colorDecayVisible = (Vec4){
                l->color.x * l->color.w,
                l->color.y * l->color.w,
                l->color.z * l->color.w,
                packLightParams(l->decay, l->visible && !culled, l->lodLevel)
            };
            
            l->dirty = 0;
        }
        #endif
        return animated || hasAnimatedLights;
    }

    // Fast path: Only spot lights
    if (!hasPointLights && hasSpotLights && !hasRectLights) {
        for (int i = 0; i < spotLightCount; i++) {
            SpotLight *l = &spotLights[i];
            SpotLightData *ld = &spotLightTexture[i];
            
            // Process animation
            if (l->anim.flags != ANIM_NONE) {
                processSpotLightAnimation(l, time);
                animated = 1;
            } else {
                l->worldPos = l->baseWorldPos;
            }
            
            // Transform position and direction to view space
            worldToView(l->worldPos.x, l->worldPos.y, l->worldPos.z, l->worldPos.w, &l->viewPos);
            worldDirToView(&l->direction, &l->viewDir);
            
            // Calculate LOD level
            l->lodLevel = calculateLOD(l->viewPos.z, l->worldPos.w);
            
            // Visibility culling
            uint8_t culled = 0;
            if (l->viewPos.z > l->worldPos.w - viewNear || l->viewPos.z < -viewFar - l->worldPos.w) {
                culled = 1;
            }
            
            ld->positionRadius = l->viewPos;
            ld->colorIntensity = l->color;
            ld->direction = l->viewDir;
            ld->angleParams = (Vec4){
                cosf(l->angle), 
                cosf(l->angle - l->penumbra), 
                l->decay, 
                packVisibleLOD(l->visible && !culled, l->lodLevel)
            };
            
            l->dirty = 0;
        }
        return animated || hasAnimatedLights;
    }

    // Fast path: Only rect lights
    if (!hasPointLights && !hasSpotLights && hasRectLights) {
        for (int i = 0; i < rectLightCount; i++) {
            RectLight *l = &rectLights[i];
            RectLightData *ld = &rectLightTexture[i];
            
            // Process animation
            if (l->anim.flags != ANIM_NONE) {
                processRectLightAnimation(l, time);
                animated = 1;
            } else {
                l->worldPos = l->baseWorldPos;
            }
            
            // Transform position and normal to view space
            worldToView(l->worldPos.x, l->worldPos.y, l->worldPos.z, l->worldPos.w, &l->viewPos);
            worldDirToView(&l->normal, &l->viewNormal);
            worldDirToView(&l->tangent, &l->viewTangent);
            
            // Calculate LOD level
            l->lodLevel = calculateLOD(l->viewPos.z, l->worldPos.w);
            
            // Visibility culling
            uint8_t culled = 0;
            if (l->viewPos.z > l->worldPos.w - viewNear || l->viewPos.z < -viewFar - l->worldPos.w) {
                culled = 1;
            }
            
            ld->positionRadius = l->viewPos;
            ld->colorIntensity = l->color;
            ld->sizeParams = (Vec4){
                l->size.x,
                l->size.y,
                l->decay,
                packVisibleLOD(l->visible && !culled, l->lodLevel)
            };
            ld->normal = l->viewNormal;
            ld->tangent = l->viewTangent;
            
            l->dirty = 0;
        }
        return animated || hasAnimatedLights;
    }

    // General path: Mixed light types
    if (hasPointLights) {
        #ifdef __wasm_simd128__
        updatePointLightsSIMD(time);
        animated = animated || (hasAnimatedLights && pointLightCount > 0);
        #else
        for (int i = 0; i < pointLightCount; i++) {
            PointLight *l = &pointLights[i];
            PointLightDataOptimized *ld = &pointLightTexture[i];
            
            if (l->anim.flags != ANIM_NONE) {
                processPointLightAnimation(l, time);
                animated = 1;
            } else {
                l->worldPos = l->baseWorldPos;
            }
            
            worldToView(l->worldPos.x, l->worldPos.y, l->worldPos.z, l->worldPos.w, &l->viewPos);
            
            // Calculate LOD level
            l->lodLevel = calculateLOD(l->viewPos.z, l->worldPos.w);
            
            uint8_t culled = 0;
            if (l->viewPos.z > l->worldPos.w - viewNear || l->viewPos.z < -viewFar - l->worldPos.w) {
                culled = 1;
            }
            
            ld->positionRadius = l->viewPos;
            ld->colorDecayVisible = (Vec4){
                l->color.x * l->color.w,
                l->color.y * l->color.w,
                l->color.z * l->color.w,
                packLightParams(l->decay, l->visible && !culled, l->lodLevel)
            };
            
            l->dirty = 0;
        }
        #endif
    }

    if (hasSpotLights) {
        for (int i = 0; i < spotLightCount; i++) {
            SpotLight *l = &spotLights[i];
            SpotLightData *ld = &spotLightTexture[i];
            
            if (l->anim.flags != ANIM_NONE) {
                processSpotLightAnimation(l, time);
                animated = 1;
            } else {
                l->worldPos = l->baseWorldPos;
            }
            
            worldToView(l->worldPos.x, l->worldPos.y, l->worldPos.z, l->worldPos.w, &l->viewPos);
            worldDirToView(&l->direction, &l->viewDir);
            
            // Calculate LOD level
            l->lodLevel = calculateLOD(l->viewPos.z, l->worldPos.w);
            
            uint8_t culled = 0;
            if (l->viewPos.z > l->worldPos.w - viewNear || l->viewPos.z < -viewFar - l->worldPos.w) {
                culled = 1;
            }
            
            ld->positionRadius = l->viewPos;
            ld->colorIntensity = l->color;
            ld->direction = l->viewDir;
            ld->angleParams = (Vec4){
                cosf(l->angle), 
                cosf(l->angle - l->penumbra), 
                l->decay, 
                packVisibleLOD(l->visible && !culled, l->lodLevel)
            };
            
            l->dirty = 0;
        }
    }

    if (hasRectLights) {
        for (int i = 0; i < rectLightCount; i++) {
            RectLight *l = &rectLights[i];
            RectLightData *ld = &rectLightTexture[i];
            
            if (l->anim.flags != ANIM_NONE) {
                processRectLightAnimation(l, time);
                animated = 1;
            } else {
                l->worldPos = l->baseWorldPos;
            }
            
            worldToView(l->worldPos.x, l->worldPos.y, l->worldPos.z, l->worldPos.w, &l->viewPos);
            worldDirToView(&l->normal, &l->viewNormal);
            worldDirToView(&l->tangent, &l->viewTangent);
            
            // Calculate LOD level
            l->lodLevel = calculateLOD(l->viewPos.z, l->worldPos.w);
            
            uint8_t culled = 0;
            if (l->viewPos.z > l->worldPos.w - viewNear || l->viewPos.z < -viewFar - l->worldPos.w) {
                culled = 1;
            }
            
            ld->positionRadius = l->viewPos;
            ld->colorIntensity = l->color;
            ld->sizeParams = (Vec4){
                l->size.x,
                l->size.y,
                l->decay,
                packVisibleLOD(l->visible && !culled, l->lodLevel)
            };
            ld->normal = l->viewNormal;
            ld->tangent = l->viewTangent;
            
            l->dirty = 0;
        }
    }

    return animated;
}

// Fast update for circular animations only
EMSCRIPTEN_KEEPALIVE void updateCircularFast(float time) {
    #ifdef __wasm_simd128__
    // Process in batches of 8 for maximum efficiency
    int i = 0;
    for (; i + 7 < pointLightCount; i += 8) {
        // Check if any in this batch have circular animation
        uint32_t animMask = 0;
        for (int j = 0; j < 8; j++) {
            if (pointLights[i + j].anim.flags & ANIM_CIRCULAR) {
                animMask |= (1 << j);
            }
        }
        
        if (animMask) {
            // Process animations for this batch
            v128_t timev = wasm_f32x4_splat(time);
            
            for (int j = 0; j < 8; j++) {
                if (animMask & (1 << j)) {
                    PointLight *l = &pointLights[i + j];
                    float phase = time * l->anim.circular.speed + (i + j) * 0.1f;
                    l->worldPos.x = l->baseWorldPos.x + sinf(phase) * l->anim.circular.radius;
                    l->worldPos.z = l->baseWorldPos.z + cosf(phase) * l->anim.circular.radius;
                }
            }
        }
    }
    
    // Handle remainder
    for (; i < pointLightCount; i++) {
        PointLight *l = &pointLights[i];
        if (l->anim.flags & ANIM_CIRCULAR) {
            float phase = time * l->anim.circular.speed + i * 0.1f;
            l->worldPos.x = l->baseWorldPos.x + sinf(phase) * l->anim.circular.radius;
            l->worldPos.z = l->baseWorldPos.z + cosf(phase) * l->anim.circular.radius;
        }
    }
    #else
    for (int i = 0; i < pointLightCount; i++) {
        PointLight *l = &pointLights[i];
        if (l->anim.flags & ANIM_CIRCULAR) {
            float phase = time * l->anim.circular.speed + i * 0.1f;
            l->worldPos.x = l->baseWorldPos.x + sinf(phase) * l->anim.circular.radius;
            l->worldPos.z = l->baseWorldPos.z + cosf(phase) * l->anim.circular.radius;
        }
    }
    #endif
}

// ──────────────────────────────────────────────────────────────
//                   PROPERTY UPDATES (MACRO-BASED)
// ──────────────────────────────────────────────────────────────

// Macros to generate update functions for all three light types
// This eliminates ~500 lines of duplicated code

#define UPDATE_POSITION(TYPE, array, count) \
EMSCRIPTEN_KEEPALIVE void update##TYPE##LightPosition(int idx, float x, float y, float z) { \
    if (idx >= 0 && idx < count) { \
        array[idx].baseWorldPos.x = x; \
        array[idx].baseWorldPos.y = y; \
        array[idx].baseWorldPos.z = z; \
        array[idx].worldPos.x = x; \
        array[idx].worldPos.y = y; \
        array[idx].worldPos.z = z; \
        array[idx].morton = computeMorton(x, z); \
        array[idx].dirty |= DIRTY_POSITION; \
        needsSort = 1; \
    } \
}

#define UPDATE_COLOR(TYPE, array, count) \
EMSCRIPTEN_KEEPALIVE void update##TYPE##LightColor(int idx, float r, float g, float b) { \
    if (idx >= 0 && idx < count) { \
        array[idx].color.x = r; \
        array[idx].color.y = g; \
        array[idx].color.z = b; \
        array[idx].dirty |= DIRTY_COLOR; \
    } \
}

#define UPDATE_INTENSITY(TYPE, array, count) \
EMSCRIPTEN_KEEPALIVE void update##TYPE##LightIntensity(int idx, float intensity) { \
    if (idx >= 0 && idx < count) { \
        array[idx].color.w = intensity; \
        array[idx].dirty |= DIRTY_COLOR; \
    } \
}

#define UPDATE_RADIUS(TYPE, array, count) \
EMSCRIPTEN_KEEPALIVE void update##TYPE##LightRadius(int idx, float radius) { \
    if (idx >= 0 && idx < count) { \
        array[idx].baseWorldPos.w = radius; \
        array[idx].worldPos.w = radius; \
        array[idx].dirty |= DIRTY_POSITION; \
    } \
}

#define UPDATE_DECAY(TYPE, array, count) \
EMSCRIPTEN_KEEPALIVE void update##TYPE##LightDecay(int idx, float decay) { \
    if (idx >= 0 && idx < count) { \
        array[idx].decay = decay; \
        array[idx].dirty |= DIRTY_PARAMS; \
    } \
}

#define UPDATE_VISIBILITY(TYPE, array, count) \
EMSCRIPTEN_KEEPALIVE void update##TYPE##LightVisibility(int idx, int visible) { \
    if (idx >= 0 && idx < count) { \
        array[idx].visible = visible ? 1 : 0; \
        array[idx].dirty |= DIRTY_PARAMS; \
    } \
}

// Generate Point Light update functions
UPDATE_POSITION(Point, pointLights, pointLightCount)
UPDATE_COLOR(Point, pointLights, pointLightCount)
UPDATE_INTENSITY(Point, pointLights, pointLightCount)
UPDATE_RADIUS(Point, pointLights, pointLightCount)
UPDATE_DECAY(Point, pointLights, pointLightCount)
UPDATE_VISIBILITY(Point, pointLights, pointLightCount)

// Generate Spot Light update functions
UPDATE_POSITION(Spot, spotLights, spotLightCount)
UPDATE_COLOR(Spot, spotLights, spotLightCount)
UPDATE_INTENSITY(Spot, spotLights, spotLightCount)
UPDATE_RADIUS(Spot, spotLights, spotLightCount)
UPDATE_DECAY(Spot, spotLights, spotLightCount)
UPDATE_VISIBILITY(Spot, spotLights, spotLightCount)

// Generate Rect Light update functions
UPDATE_POSITION(Rect, rectLights, rectLightCount)
UPDATE_COLOR(Rect, rectLights, rectLightCount)
UPDATE_INTENSITY(Rect, rectLights, rectLightCount)
UPDATE_RADIUS(Rect, rectLights, rectLightCount)
UPDATE_DECAY(Rect, rectLights, rectLightCount)
UPDATE_VISIBILITY(Rect, rectLights, rectLightCount)

// Point Light specific: base color updates for animations
EMSCRIPTEN_KEEPALIVE void updatePointLightAnimation(int idx, uint32_t animFlags,
    float circSpeed, float circRadius,
    float targetX, float targetY, float targetZ, float duration, float delay, uint8_t linearMode,
    float waveAxisX, float waveAxisY, float waveAxisZ, float waveSpeed, float waveAmplitude, float wavePhase,
    float flickerSpeed, float flickerIntensity, float flickerSeed,
    float pulseSpeed, float pulseAmount, uint8_t pulseTarget) {

    if (idx >= 0 && idx < pointLightCount) {
        PointLight *l = &pointLights[idx];
        uint32_t oldFlags = l->anim.flags;
        l->anim.flags = animFlags;

        if (animFlags & ANIM_CIRCULAR) {
            l->anim.circular.speed = circSpeed;
            l->anim.circular.radius = circRadius;
        }

        if (animFlags & ANIM_LINEAR) {
            l->anim.linear.targetPos = (Vec4){targetX, targetY, targetZ, 0};
            l->anim.linear.duration = duration;
            l->anim.linear.delay = delay;
            l->anim.linear.mode = linearMode;
        }

        if (animFlags & ANIM_WAVE) {
            l->anim.wave.axis = (Vec4){waveAxisX, waveAxisY, waveAxisZ, 0};
            l->anim.wave.speed = waveSpeed;
            l->anim.wave.amplitude = waveAmplitude;
            l->anim.wave.phase = wavePhase;
        }

        if (animFlags & ANIM_FLICKER) {
            l->anim.flicker.speed = flickerSpeed;
            l->anim.flicker.intensity = flickerIntensity;
            l->anim.flicker.seed = flickerSeed;
        }

        if (animFlags & ANIM_PULSE) {
            l->anim.pulse.speed = pulseSpeed;
            l->anim.pulse.amount = pulseAmount;
            l->anim.pulse.target = pulseTarget;
        }

        if (animFlags != oldFlags) {
            if (animFlags != ANIM_NONE) {
                hasAnimatedLights = 1;
            }
        }
        l->dirty |= DIRTY_ALL;
    }
}

// Spot Light specific functions
EMSCRIPTEN_KEEPALIVE void updateSpotLightDirection(int idx, float dx, float dy, float dz) {
    if (idx >= 0 && idx < spotLightCount) {
        SpotLight *l = &spotLights[idx];
        float len = sqrtf(dx*dx + dy*dy + dz*dz);
        if (len > 0.0001f) {
            l->direction.x = dx / len;
            l->direction.y = dy / len;
            l->direction.z = dz / len;
            l->baseDir = l->direction;
            l->dirty |= DIRTY_PARAMS;
        }
    }
}

EMSCRIPTEN_KEEPALIVE void updateSpotLightAngle(int idx, float angle, float penumbra) {
    if (idx >= 0 && idx < spotLightCount) {
        spotLights[idx].angle = angle;
        spotLights[idx].penumbra = penumbra;
        spotLights[idx].dirty |= DIRTY_PARAMS;
    }
}

EMSCRIPTEN_KEEPALIVE void updateSpotLightAnimation(int idx, uint32_t animFlags,
    float circSpeed, float circRadius,
    float targetX, float targetY, float targetZ, float duration, float delay, uint8_t linearMode,
    float waveAxisX, float waveAxisY, float waveAxisZ, float waveSpeed, float waveAmplitude, float wavePhase,
    float flickerSpeed, float flickerIntensity, float flickerSeed,
    float pulseSpeed, float pulseAmount, uint8_t pulseTarget,
    float rotAxisX, float rotAxisY, float rotAxisZ, float rotSpeed, float rotAngle, uint8_t rotMode) {

    if (idx >= 0 && idx < spotLightCount) {
        SpotLight *l = &spotLights[idx];
        uint32_t oldFlags = l->anim.flags;
        l->anim.flags = animFlags;

        if (animFlags & ANIM_CIRCULAR) {
            l->anim.circular.speed = circSpeed;
            l->anim.circular.radius = circRadius;
        }

        if (animFlags & ANIM_LINEAR) {
            l->anim.linear.targetPos = (Vec4){targetX, targetY, targetZ, 0};
            l->anim.linear.duration = duration;
            l->anim.linear.delay = delay;
            l->anim.linear.mode = linearMode;
        }

        if (animFlags & ANIM_WAVE) {
            l->anim.wave.axis = (Vec4){waveAxisX, waveAxisY, waveAxisZ, 0};
            l->anim.wave.speed = waveSpeed;
            l->anim.wave.amplitude = waveAmplitude;
            l->anim.wave.phase = wavePhase;
        }

        if (animFlags & ANIM_FLICKER) {
            l->anim.flicker.speed = flickerSpeed;
            l->anim.flicker.intensity = flickerIntensity;
            l->anim.flicker.seed = flickerSeed;
        }

        if (animFlags & ANIM_PULSE) {
            l->anim.pulse.speed = pulseSpeed;
            l->anim.pulse.amount = pulseAmount;
            l->anim.pulse.target = pulseTarget;
        }

        if (animFlags & ANIM_ROTATE) {
            l->anim.rotation.axis = (Vec4){rotAxisX, rotAxisY, rotAxisZ, 0};
            l->anim.rotation.speed = rotSpeed;
            l->anim.rotation.angle = rotAngle;
            l->anim.rotation.mode = rotMode;
        }

        if (animFlags != oldFlags) {
            if (animFlags != ANIM_NONE) {
                hasAnimatedLights = 1;
            }
        }
        l->dirty |= DIRTY_ALL;
    }
}

// Rect Light specific functions
EMSCRIPTEN_KEEPALIVE void updateRectLightSize(int idx, float width, float height) {
    if (idx >= 0 && idx < rectLightCount) {
        rectLights[idx].size.x = width;
        rectLights[idx].size.y = height;
        rectLights[idx].dirty |= DIRTY_PARAMS;
    }
}

EMSCRIPTEN_KEEPALIVE void updateRectLightNormal(int idx, float nx, float ny, float nz) {
    if (idx >= 0 && idx < rectLightCount) {
        RectLight *l = &rectLights[idx];
        float len = sqrtf(nx*nx + ny*ny + nz*nz);
        if (len > 0.0001f) {
            l->normal.x = nx / len;
            l->normal.y = ny / len;
            l->normal.z = nz / len;
            l->baseNormal = l->normal;

            // Recompute tangent frame with consistent helper alignment
            buildOrthonormalBasis(&l->normal, &l->tangent, &l->bitangent);
            l->baseTangent = l->tangent;
            l->baseBitangent = l->bitangent;
            l->dirty |= DIRTY_PARAMS;
        }
    }
}

EMSCRIPTEN_KEEPALIVE void updateRectLightAnimation(int idx, uint32_t animFlags,
    float circSpeed, float circRadius,
    float targetX, float targetY, float targetZ, float duration, float delay, uint8_t linearMode,
    float waveAxisX, float waveAxisY, float waveAxisZ, float waveSpeed, float waveAmplitude, float wavePhase,
    float flickerSpeed, float flickerIntensity, float flickerSeed,
    float pulseSpeed, float pulseAmount, uint8_t pulseTarget,
    float rotAxisX, float rotAxisY, float rotAxisZ, float rotSpeed, float rotAngle, uint8_t rotMode) {

    if (idx >= 0 && idx < rectLightCount) {
        RectLight *l = &rectLights[idx];
        uint32_t oldFlags = l->anim.flags;
        l->anim.flags = animFlags;

        if (animFlags & ANIM_CIRCULAR) {
            l->anim.circular.speed = circSpeed;
            l->anim.circular.radius = circRadius;
        }

        if (animFlags & ANIM_LINEAR) {
            l->anim.linear.targetPos = (Vec4){targetX, targetY, targetZ, 0};
            l->anim.linear.duration = duration;
            l->anim.linear.delay = delay;
            l->anim.linear.mode = linearMode;
        }

        if (animFlags & ANIM_WAVE) {
            l->anim.wave.axis = (Vec4){waveAxisX, waveAxisY, waveAxisZ, 0};
            l->anim.wave.speed = waveSpeed;
            l->anim.wave.amplitude = waveAmplitude;
            l->anim.wave.phase = wavePhase;
        }

        if (animFlags & ANIM_FLICKER) {
            l->anim.flicker.speed = flickerSpeed;
            l->anim.flicker.intensity = flickerIntensity;
            l->anim.flicker.seed = flickerSeed;
        }

        if (animFlags & ANIM_PULSE) {
            l->anim.pulse.speed = pulseSpeed;
            l->anim.pulse.amount = pulseAmount;
            l->anim.pulse.target = pulseTarget;
        }

        if (animFlags & ANIM_ROTATE) {
            l->anim.rotation.axis = (Vec4){rotAxisX, rotAxisY, rotAxisZ, 0};
            l->anim.rotation.speed = rotSpeed;
            l->anim.rotation.angle = rotAngle;
            l->anim.rotation.mode = rotMode;
        }

        if (animFlags != oldFlags) {
            if (animFlags != ANIM_NONE) {
                hasAnimatedLights = 1;
            }
        }
        l->dirty |= DIRTY_ALL;
    }
}

// ──────────────────────────────────────────────────────────────
//                    STATE EXPOSURE TO JS
// ──────────────────────────────────────────────────────────────
EMSCRIPTEN_KEEPALIVE void reset(void) {
    pointLightCount = 0;
    spotLightCount = 0;
    rectLightCount = 0;
    needsSort = 0;
    hasAnimatedLights = 0;
    hasPointLights = 0;
    hasSpotLights = 0;
    hasRectLights = 0;
}

// Set light count directly (for reusing pre-allocated slots)
EMSCRIPTEN_KEEPALIVE void setPointLightCount(int count) {
    if (count >= 0 && count <= maxLights) {
        pointLightCount = count;
        hasPointLights = (count > 0);
    }
}

EMSCRIPTEN_KEEPALIVE void setSpotLightCount(int count) {
    if (count >= 0 && count <= maxLights) {
        spotLightCount = count;
        hasSpotLights = (count > 0);
    }
}

EMSCRIPTEN_KEEPALIVE void setRectLightCount(int count) {
    if (count >= 0 && count <= maxLights) {
        rectLightCount = count;
        hasRectLights = (count > 0);
    }
}

EMSCRIPTEN_KEEPALIVE void* getCameraMatrix(void) { return (void*)cameraMatrix; }
EMSCRIPTEN_KEEPALIVE void* getPointLightTexture(void) { return (void*)pointLightTexture; }
EMSCRIPTEN_KEEPALIVE void* getSpotLightTexture(void) { return (void*)spotLightTexture; }
EMSCRIPTEN_KEEPALIVE void* getRectLightTexture(void) { return (void*)rectLightTexture; }
EMSCRIPTEN_KEEPALIVE int getPointLightCount(void) { return pointLightCount; }
EMSCRIPTEN_KEEPALIVE int getSpotLightCount(void) { return spotLightCount; }
EMSCRIPTEN_KEEPALIVE int getRectLightCount(void) { return rectLightCount; }
EMSCRIPTEN_KEEPALIVE int getHasAnimatedLights(void) { return hasAnimatedLights; }
EMSCRIPTEN_KEEPALIVE int getHasPointLights(void) { return hasPointLights; }
EMSCRIPTEN_KEEPALIVE int getHasSpotLights(void) { return hasSpotLights; }
EMSCRIPTEN_KEEPALIVE int getHasRectLights(void) { return hasRectLights; }

// Get memory pointers for external integrations (e.g., radiance cascades)
EMSCRIPTEN_KEEPALIVE int* getPointLightCountPtr(void) { return &pointLightCount; }
EMSCRIPTEN_KEEPALIVE int* getSpotLightCountPtr(void) { return &spotLightCount; }
EMSCRIPTEN_KEEPALIVE int* getRectLightCountPtr(void) { return &rectLightCount; }
EMSCRIPTEN_KEEPALIVE void* getPointLightsArrayPtr(void) { return (void*)&pointLights; }
EMSCRIPTEN_KEEPALIVE void* getSpotLightsArrayPtr(void) { return (void*)&spotLights; }
EMSCRIPTEN_KEEPALIVE void* getRectLightsArrayPtr(void) { return (void*)&rectLights; }

// Get animation flags for a specific light
EMSCRIPTEN_KEEPALIVE uint32_t getPointLightAnimFlags(int idx) {
    if (idx >= 0 && idx < pointLightCount) {
        return pointLights[idx].anim.flags;
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE uint32_t getSpotLightAnimFlags(int idx) {
    if (idx >= 0 && idx < spotLightCount) {
        return spotLights[idx].anim.flags;
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE uint32_t getRectLightAnimFlags(int idx) {
    if (idx >= 0 && idx < rectLightCount) {
        return rectLights[idx].anim.flags;
    }
    return 0;
}

// Get LOD level for debugging
EMSCRIPTEN_KEEPALIVE uint8_t getPointLightLOD(int idx) {
    if (idx >= 0 && idx < pointLightCount) {
        return pointLights[idx].lodLevel;
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE uint8_t getSpotLightLOD(int idx) {
    if (idx >= 0 && idx < spotLightCount) {
        return spotLights[idx].lodLevel;
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE uint8_t getRectLightLOD(int idx) {
    if (idx >= 0 && idx < rectLightCount) {
        return rectLights[idx].lodLevel;
    }
    return 0;
}
