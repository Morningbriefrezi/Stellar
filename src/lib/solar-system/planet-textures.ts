import * as THREE from 'three';
import type { SolarBodyId } from '@/lib/solar-system/ephemeris';
import { bodyColor, worldRadiusForBody } from '@/lib/solar-system/ephemeris';
import { AXIAL_TILT_DEG } from '@/lib/solar-system/planet-spin';
import {
  getSaturnRingStripTexture,
  SATURN_RING_INNER,
  SATURN_RING_OUTER,
} from '@/lib/solar-system/saturn-ring-strip';

const SRGB = THREE.SRGBColorSpace;

const GAS_GIANTS: ReadonlySet<SolarBodyId> = new Set(['jupiter', 'saturn', 'uranus', 'neptune']);

/** Metalness 0 everywhere. A gas giant's cloud deck is a diffuse scatterer —
 *  Voyager and Cassini never caught a specular highlight on one — so it wants to
 *  be nearly fully rough; at 0.4 the giants carried a glossy sheen. */
function roughnessFor(id: SolarBodyId): number {
  return GAS_GIANTS.has(id) ? 0.95 : 0.8;
}

function canvasTexture(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w = 1024,
  h = 512,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = SRGB;
    return t;
  }
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = SRGB;
  tex.anisotropy = 8;
  return tex;
}

function noiseRoughness(ctx: CanvasRenderingContext2D, w: number, h: number, grain: number) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * grain + 0.5;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.floor(n * 255);
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ───────────── shader hooks (onBeforeCompile on MeshStandardMaterial) ───────────── */

type CompiledShader = Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];

// World-space position + normal varyings; the Sun is fixed at the scene
// origin (see sampleSolarSystem), so the light direction is simply -worldPos.
const WORLD_PARS = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNrm;
varying vec3 vWorldCenter;
`;
const WORLD_VERTEX = /* glsl */ `
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWorldNrm = normalize(mat3(modelMatrix) * objectNormal);
vWorldCenter = modelMatrix[3].xyz;
`;

function injectWorldVaryings(shader: CompiledShader) {
  // A planet can carry several hooks that want these, so this has to be
  // idempotent. Match vWorldNrm, not vWorldPos: three declares its own
  // `vWorldPosition`, which vWorldPos is a substring of, and testing for that
  // skips the injection every time and leaves the hooks referencing
  // identifiers nobody declared.
  if (shader.vertexShader.includes('vWorldNrm')) return;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WORLD_PARS}`)
    .replace('#include <fog_vertex>', `#include <fog_vertex>\n${WORLD_VERTEX}`);
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>\n${WORLD_PARS}`,
  );
}

/** A shader edit a material can carry alongside others — Saturn needs three at
 *  once (cloud shear, its own ring shadow, limb falloff) and `onBeforeCompile`
 *  is a single slot. */
type ShaderMutator = (shader: CompiledShader) => void;

/** Earth: city lights only on the hemisphere facing away from the Sun. */
const earthNight: ShaderMutator = (shader) => {
  injectWorldVaryings(shader);
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    /* glsl */ `#include <emissivemap_fragment>
    {
      float sunFacing = dot(normalize(vWorldNrm), normalize(-vWorldPos));
      totalEmissiveRadiance *= smoothstep(0.12, -0.2, sunFacing);
    }`,
  );
};

/** Measured peak zonal wind at each giant's equator (m/s, signed against the
 *  body's own rotation) and how many alternating jets run from equator to pole.
 *  Saturn's equatorial jet is the fastest prograde flow in the solar system;
 *  Uranus and Neptune blow retrograde at the equator, Neptune hardest of all.
 *  Driving the shear from the real figures keeps the four visibly different
 *  from one another instead of all drifting alike. */
interface WindField {
  equatorialMs: number;
  jets: number;
  /** Relative eddy activity — Uranus is famously bland, Jupiter is not. */
  eddy: number;
  /** How much procedural cloud structure rides on top of the map. This is
   *  what holds the surface together under close zoom: the map runs out of
   *  pixels, the noise does not. */
  detail: number;
  /** A signature storm the base map doesn't carry, as
   *  [longitude, latitude, radius, spin] in UV units. */
  storm?: [number, number, number, number];
}

const WIND_FIELD: Partial<Record<SolarBodyId, WindField>> = {
  jupiter: { equatorialMs: 100, jets: 7, eddy: 1, detail: 0.30 },
  saturn: { equatorialMs: 470, jets: 5, eddy: 0.7, detail: 0.22 },
  uranus: { equatorialMs: -100, jets: 3, eddy: 0.3, detail: 0.07 },
  // Neptune's map is a bare blue ball. The Great Dark Spot Voyager 2 found in
  // 1989 sat at about 22° S — an anticyclone the width of Earth, trailed by
  // bright methane cirrus. It's the picture everyone knows of the planet, so
  // it gets drawn rather than left off.
  neptune: { equatorialMs: -400, jets: 4, eddy: 0.9, detail: 0.20, storm: [0.32, 0.38, 0.075, 1.0] },
};

/** Jupiter sets the on-screen pace; the rest scale off it sub-linearly, so
 *  Saturn still reads as the fastest without whipping round the globe. */
function driftRate(wind: WindField): number {
  const ratio = Math.abs(wind.equatorialMs) / 100;
  return Math.sign(wind.equatorialMs) * ratio ** 0.6 * 0.004;
}

/** Value-noise fBm that tiles along longitude. The naive version leaves a
 *  visible seam down the prime meridian of every gas giant, so the lattice
 *  wraps on a period that doubles with each octave. */
const noiseGlsl = (octaves: number) => /* glsl */ `
float atmHash(vec2 p) {
  p = fract(p * vec2(127.31, 311.7));
  p += dot(p, p + 47.13);
  return fract(p.x * p.y);
}
float atmNoise(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = atmHash(vec2(mod(i.x, period), i.y));
  float b = atmHash(vec2(mod(i.x + 1.0, period), i.y));
  float c = atmHash(vec2(mod(i.x, period), i.y + 1.0));
  float d = atmHash(vec2(mod(i.x + 1.0, period), i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float atmFbm(vec2 p, float period) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < ${octaves}; i++) {
    v += amp * atmNoise(p, period);
    p *= 2.0;
    period *= 2.0;
    amp *= 0.5;
  }
  return v;
}
`;

/**
 * A gas giant's weather. Alternating zonal jets advect the cloud map by
 * latitude, a domain-warped turbulence field curls it into eddies at the
 * shear boundaries, and a high-frequency band of the same field paints
 * ammonia cirrus over the zones and dark festoons over the belts.
 *
 * The cirrus layer is the answer to close zoom: it's procedural, so it has
 * detail at every scale, and it fades up as the planet grows on screen —
 * exactly where a finite map would otherwise go soft.
 */
function gasGiantAtmosphere(id: SolarBodyId, wind: WindField, lite: boolean): ShaderMutator {
  const octaves = lite ? 3 : 5;
  const storm = wind.storm ?? [0, 0, 0, 0];
  return (shader) => {
    injectWorldVaryings(shader);
    shader.uniforms.uBandTime = { value: 0 };
    shader.uniforms.uBandAmp = { value: wind.eddy * (lite ? 0.0015 : 0.0026) };
    shader.uniforms.uDrift = { value: driftRate(wind) };
    shader.uniforms.uJets = { value: wind.jets };
    shader.uniforms.uCurl = { value: wind.eddy * 0.022 };
    shader.uniforms.uDetail = { value: lite ? wind.detail * 0.6 : wind.detail };
    shader.uniforms.uRadius = { value: worldRadiusForBody(id) };
    shader.uniforms.uStorm = { value: new THREE.Vector4(...storm) };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uBandTime;
        uniform float uBandAmp;
        uniform float uDrift;
        uniform float uJets;
        uniform float uCurl;
        uniform float uDetail;
        uniform float uRadius;
        uniform vec4 uStorm;
        ${noiseGlsl(octaves)}`,
      )
      .replace(
        'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
        /* glsl */ `vec2 bUv = vMapUv;
        float bLat = (bUv.y - 0.5) * 3.14159265;
        // Alternating east/west jets by latitude, fastest at the equator.
        float jet = sin(bLat * uJets + 0.6) * 0.55 + sin(bLat * uJets * 0.43) * 0.45;
        float adv = jet * uBandTime * uDrift;
        bUv.x += adv;
        bUv.x += sin(bUv.y * 40.0 + uBandTime * 0.35) * uBandAmp;
        bUv.y += sin(bUv.x * 30.0 + uBandTime * 0.27 + bLat * 2.0) * uBandAmp * 0.6;

        // Turbulence, stretched hard along longitude the way zonal flow
        // stretches everything into ribbons. Each field's lattice period has
        // to equal its longitude frequency, or the noise fails to wrap and
        // leaves a seam down the prime meridian — hence the whole integers.
        vec2 warpUv = vec2(bUv.x * 8.0 + adv * 16.0 + uBandTime * 0.03, bUv.y * 32.0);
        float warp = atmFbm(warpUv, 8.0);
        vec2 tUv = vec2(bUv.x * 24.0 + adv * 48.0, bUv.y * 96.0);
        float turb = atmFbm(tUv + vec2(warp * 2.2, warp * 0.6), 24.0);

        // Shear the map by the turbulence so its own belts curl into eddies
        // instead of sliding rigidly past one another.
        bUv.x += (turb - 0.5) * uCurl;
        bUv.y += (turb - 0.5) * uCurl * 0.2;

        // A resident anticyclone, where the base map lacks one. Inside its
        // ellipse the sample is rotated, which drags the surrounding bands
        // around the vortex the way a real storm does.
        float stormMask = 0.0;
        if (uStorm.z > 0.0) {
          vec2 sd = vec2(fract(bUv.x - uStorm.x + 0.5) - 0.5, (bUv.y - uStorm.y) * 1.9);
          float sr = length(sd) / uStorm.z;
          stormMask = 1.0 - smoothstep(0.55, 1.0, sr);
          float spin = uStorm.w * stormMask * (0.9 + uBandTime * 0.012);
          float cs = cos(spin);
          float sn = sin(spin);
          bUv += vec2(sd.x * cs - sd.y * sn - sd.x, (sd.x * sn + sd.y * cs - sd.y) / 1.9) * 0.5;
        }

        vec4 sampledDiffuseColor = texture2D( map, bUv );

        // Cloud detail on top of the map — bright ammonia cirrus over the
        // zones, dark festoons over the belts. It is off entirely at a
        // distance, where features this fine would only alias into shimmer,
        // and comes up as the planet grows on screen: structure exactly where
        // the map itself runs out of pixels.
        float appar = uRadius / max(length(cameraPosition - vWorldPos), 1e-4);
        float amt = uDetail * smoothstep(0.02, 0.15, appar);
        vec2 fineUv = vec2(bUv.x * 64.0 + adv * 128.0, bUv.y * 256.0);
        float fine = atmFbm(fineUv + vec2(warp * 1.4, 0.0), 64.0) - 0.5;
        sampledDiffuseColor.rgb *= 1.0 + fine * amt * 1.6;
        if (uStorm.z > 0.0) {
          // The spot itself, plus the bright methane cirrus along its edge.
          sampledDiffuseColor.rgb *= 1.0 - stormMask * 0.42;
          float rim = stormMask * (1.0 - stormMask) * 4.0;
          sampledDiffuseColor.rgb += vec3(0.10, 0.13, 0.16) * rim * max(0.0, fine + 0.35);
        }`,
      );
  };
}

/** A deep atmosphere scatters less light back at you as the view angle grazes,
 *  so a giant's disc falls off toward the limb instead of reading as a flat
 *  cut-out of its map. */
function limbDarken(strength: number): ShaderMutator {
  return (shader) => {
    injectWorldVaryings(shader);
    shader.uniforms.uLimb = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLimb;')
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        {
          float mu = clamp(dot(normalize(vWorldNrm), normalize(cameraPosition - vWorldPos)), 0.0, 1.0);
          float limb = mix(1.0, pow(mu, 0.55), uLimb);
          reflectedLight.directDiffuse *= limb;
          reflectedLight.indirectDiffuse *= limb;
        }`,
      );
  };
}

/** Saturn: the ring system casts its banded shadow onto the globe. */
function ringShadow(): ShaderMutator {
  const R = worldRadiusForBody('saturn');
  const tilt = THREE.MathUtils.degToRad(AXIAL_TILT_DEG.saturn);
  return (shader) => {
    injectWorldVaryings(shader);
    shader.uniforms.uRingTex = { value: getSaturnRingStripTexture() };
    // Ring plane normal in world space: the rings share the planet's Z tilt.
    shader.uniforms.uRingNormal = { value: new THREE.Vector3(-Math.sin(tilt), Math.cos(tilt), 0) };
    shader.uniforms.uRingInner = { value: R * SATURN_RING_INNER };
    shader.uniforms.uRingOuter = { value: R * SATURN_RING_OUTER };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform sampler2D uRingTex;
        uniform vec3 uRingNormal;
        uniform float uRingInner;
        uniform float uRingOuter;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        {
          vec3 toSun = normalize(-vWorldPos);
          vec3 rel = vWorldPos - vWorldCenter;
          float denom = dot(toSun, uRingNormal);
          float ringShadow = 1.0;
          if (abs(denom) > 1e-4) {
            float tHit = -dot(rel, uRingNormal) / denom;
            if (tHit > 0.0) {
              float rHit = length(rel + toSun * tHit);
              float u = (rHit - uRingInner) / (uRingOuter - uRingInner);
              if (u > 0.0 && u < 1.0) {
                ringShadow = 1.0 - texture2D(uRingTex, vec2(u, 0.5)).a * 0.88;
              }
            }
          }
          reflectedLight.directDiffuse *= ringShadow;
          reflectedLight.directSpecular *= ringShadow;
        }`,
      );
  };
}

function applyHooks(id: SolarBodyId, mat: THREE.MeshStandardMaterial, lite: boolean) {
  const mutators: ShaderMutator[] = [];
  if (id === 'earth') mutators.push(earthNight);
  const wind = WIND_FIELD[id];
  if (wind) mutators.push(gasGiantAtmosphere(id, wind, lite));
  if (id === 'saturn') mutators.push(ringShadow());
  // The Sun lights itself, so grazing angles don't dim it.
  if (GAS_GIANTS.has(id)) mutators.push(limbDarken(0.55));
  if (!mutators.length) return;
  mat.onBeforeCompile = (shader) => {
    for (const mutate of mutators) mutate(shader);
    mat.userData.shader = shader;
  };
}

/** Per-frame time for the animated cloud-band materials (no-op for the rest). */
export function tickPlanetMaterial(mat: THREE.Material, timeSec: number) {
  const shader = mat.userData.shader as CompiledShader | undefined;
  const u = shader?.uniforms.uBandTime;
  if (u) u.value = timeSec;
}

/* ───────────────────────────── materials ───────────────────────────── */

/** Hero NASA map when available, procedural diffuse fallback otherwise. */
export function createPlanetMaterial(
  id: SolarBodyId,
  lite: boolean,
  diffuseTexture?: THREE.Texture | null,
): THREE.MeshStandardMaterial {
  const mat = diffuseTexture
    ? texturedMaterial(id, lite, diffuseTexture)
    : proceduralMaterial(id, lite);
  applyHooks(id, mat, lite);
  return mat;
}

function texturedMaterial(
  id: SolarBodyId,
  lite: boolean,
  diffuseTexture: THREE.Texture,
): THREE.MeshStandardMaterial {
  if (id === 'sun') {
    return new THREE.MeshStandardMaterial({
      map: diffuseTexture,
      emissive: new THREE.Color(0xfff0cc),
      emissiveMap: diffuseTexture,
      emissiveIntensity: lite ? 1.15 : 1.35,
      roughness: 0.92,
      metalness: 0,
    });
  }
  const mat = new THREE.MeshStandardMaterial({
    map: diffuseTexture,
    roughness: roughnessFor(id),
    metalness: 0,
  });
  // Reuse the diffuse map as a bump map on the dry rocky bodies — under the
  // sharp low-ambient sun lighting this gives craters and ridges real relief
  // at the terminator without needing a dedicated height map.
  if (id === 'mercury' || id === 'mars' || id === 'pluto') {
    mat.bumpMap = diffuseTexture;
    mat.bumpScale = id === 'mars' ? 0.016 : 0.01;
  }
  return mat;
}

function proceduralMaterial(id: SolarBodyId, lite: boolean): THREE.MeshStandardMaterial {
  const base = bodyColor(id);
  const hex = `#${base.toString(16).padStart(6, '0')}`;
  const roughness = roughnessFor(id);

  if (id === 'sun') {
    const map = canvasTexture((ctx, w, h) => {
      const g = ctx.createRadialGradient(w * 0.35, h * 0.35, 0, w * 0.5, h * 0.5, w * 0.65);
      g.addColorStop(0, '#fff9e6');
      g.addColorStop(0.35, '#ffe08a');
      g.addColorStop(0.7, '#f5a623');
      g.addColorStop(1, '#c76a10');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    return new THREE.MeshStandardMaterial({
      map,
      emissive: new THREE.Color(0xf6c15c),
      emissiveMap: map,
      emissiveIntensity: lite ? 1.15 : 1.4,
      roughness: 0.9,
      metalness: 0,
    });
  }

  if (id === 'jupiter' || id === 'saturn') {
    const map = canvasTexture((ctx, w, h) => {
      const bands = id === 'jupiter' ? 22 : 16;
      for (let i = 0; i < bands; i++) {
        const y0 = (i / bands) * h;
        const y1 = ((i + 1) / bands) * h;
        const t = i / bands;
        const shade = 0.55 + 0.45 * Math.sin(t * Math.PI * 3.2);
        const drift = id === 'jupiter' ? 0.08 * Math.sin(t * 12) : 0.05 * Math.sin(t * 9);
        ctx.fillStyle = `rgb(${200 * shade * (1 - drift)},${170 * shade},${120 * shade})`;
        ctx.fillRect(0, y0, w, y1 - y0);
      }
    });
    return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
  }

  if (id === 'earth') {
    const map = canvasTexture((ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#1a4a7a');
      g.addColorStop(0.35, '#2d6aab');
      g.addColorStop(0.55, '#3d7d6a');
      g.addColorStop(0.72, '#2d6aab');
      g.addColorStop(1, '#1a3d6a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(200,220,255,0.35)';
      for (let i = 0; i < 40; i++) {
        const cx = Math.random() * w;
        const cy = Math.random() * h;
        const rw = 8 + Math.random() * 40;
        const rh = 6 + Math.random() * 20;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rw, rh, Math.random(), 0, Math.PI * 2);
        ctx.fill();
      }
    });
    return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
  }

  if (id === 'mars') {
    const map = canvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#9e3d28';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = `rgba(${40 + Math.random() * 40},${20 + Math.random() * 25},${15 + Math.random() * 20},0.4)`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 4 + Math.random() * 30, 3 + Math.random() * 20);
      }
    });
    return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
  }

  if (id === 'venus') {
    const map = canvasTexture((ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#e8dcc8');
      g.addColorStop(0.5, '#d4c4a8');
      g.addColorStop(1, '#c8b898');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.15;
      for (let y = 0; y < h; y += 3) {
        ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#a09078';
        ctx.fillRect(0, y, w, 2);
      }
      ctx.globalAlpha = 1;
    });
    return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
  }

  if (id === 'mercury') {
    const map = canvasTexture((ctx, w, h) => {
      ctx.fillStyle = hex;
      ctx.fillRect(0, 0, w, h);
      noiseRoughness(ctx, w, h, 0.35);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 80; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 8, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
  }

  if (id === 'uranus' || id === 'neptune') {
    const map = canvasTexture((ctx, w, h) => {
      const g = ctx.createRadialGradient(w * 0.3, h * 0.4, 0, w * 0.5, h * 0.5, w * 0.55);
      if (id === 'uranus') {
        g.addColorStop(0, '#b8dfe8');
        g.addColorStop(1, '#4a8a9a');
      } else {
        g.addColorStop(0, '#6a8ce0');
        g.addColorStop(1, '#1a2a70');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      noiseRoughness(ctx, w, h, 0.08);
    });
    return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
  }

  if (id === 'pluto') {
    const map = canvasTexture((ctx, w, h) => {
      ctx.fillStyle = '#a89888';
      ctx.fillRect(0, 0, w, h);
      noiseRoughness(ctx, w, h, 0.2);
      ctx.fillStyle = 'rgba(60,50,45,0.25)';
      for (let i = 0; i < 30; i++) {
        ctx.fillRect(Math.random() * w, Math.random() * h, 20, 12);
      }
    });
    return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
  }

  const map = canvasTexture((ctx, w, h) => {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, w, h);
    noiseRoughness(ctx, w, h, 0.18);
  });
  return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
}

export function disposePlanetMaterial(mat: THREE.Material) {
  if (!(mat instanceof THREE.MeshStandardMaterial)) {
    mat.dispose();
    return;
  }
  if (mat.emissiveMap && mat.emissiveMap === mat.map) {
    mat.emissiveMap = null;
  }
  if (mat.bumpMap && mat.bumpMap === mat.map) {
    mat.bumpMap = null;
  }
  mat.map?.dispose();
  mat.emissiveMap?.dispose();
  mat.normalMap?.dispose();
  mat.roughnessMap?.dispose();
  mat.dispose();
}
