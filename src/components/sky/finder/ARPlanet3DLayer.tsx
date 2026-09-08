'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';

export interface PlanetPlacement {
  id: string;
  screenX: number;
  screenY: number;
  size: number;
  visible: boolean;
}

/** Imperative handle — the AR finder's RAF loop pushes placements straight
 *  into the layer's refs each frame, so updating planet positions never
 *  re-renders React. */
export interface ARPlanet3DHandle {
  update(planets: PlanetPlacement[], sunScreen: { x: number; y: number } | null): void;
}

interface Props {
  width: number;
  height: number;
}

const PLANET_IDS = ['sun','moon','mercury','venus','earth','mars','jupiter','saturn','uranus','neptune'] as const;
type PId = typeof PLANET_IDS[number];

const TEX_URL: Record<PId, string> = {
  sun:     '/solar-system/planets/sun.jpg',
  moon:    '/images/planets/moon.jpg',
  mercury: '/solar-system/planets/mercury.jpg',
  venus:   '/solar-system/planets/venus.jpg',
  earth:   '/solar-system/planets/earth.jpg',
  mars:    '/solar-system/planets/mars.jpg',
  jupiter: '/solar-system/planets/jupiter.jpg',
  saturn:  '/solar-system/planets/saturn.jpg',
  uranus:  '/solar-system/planets/uranus.jpg',
  neptune: '/solar-system/planets/neptune.jpg',
};

const SATURN_RINGS_URL = '/solar-system/planets/saturn-rings.png';

const SPIN_RAD_PER_SEC: Record<PId, number> = {
  sun: 0.04, moon: 0, mercury: 0.06, venus: -0.05, earth: 0.18, mars: 0.16,
  jupiter: 0.28, saturn: 0.24, uranus: 0.10, neptune: 0.10,
};

const SATURN_TILT_RAD = THREE.MathUtils.degToRad(26.7);
const URANUS_TILT_RAD = THREE.MathUtils.degToRad(97.8);

const planetVert = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const planetFrag = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDir;
  uniform float uAmbient;
  uniform float uRim;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vec3 N = normalize(vNormal);
    float d = max(dot(N, normalize(uSunDir)), 0.0);
    float lit = uAmbient + (1.0 - uAmbient) * d;
    vec3 base = texture2D(uMap, vUv).rgb;
    // Subtle rim — fades edges toward the void, sells the sphere shape.
    float rim = pow(1.0 - max(N.z, 0.0), 2.5) * uRim;
    vec3 col = base * lit + vec3(0.05, 0.07, 0.10) * rim * lit;
    gl_FragColor = vec4(col, 1.0);
  }
`;

interface PlanetEntry {
  group: THREE.Group;          // positioned at planet's screen coord, scaled by size
  body: THREE.Mesh;            // the sphere
  rings?: THREE.Mesh;          // saturn-only
  material: THREE.ShaderMaterial | THREE.MeshBasicMaterial;
  isSun: boolean;
}

export const ARPlanet3DLayer = forwardRef<ARPlanet3DHandle, Props>(function ARPlanet3DLayer(
  { width, height },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    entries: Map<PId, PlanetEntry>;
    sunHaloMesh: THREE.Mesh;
    planetsRef: { current: PlanetPlacement[] };
    sunRef: { current: { x: number; y: number } | null };
    dimsRef: { current: { w: number; h: number } };
  } | null>(null);

  // Latest placements live in refs so the rAF loop reads them without a
  // React render. The parent pushes them imperatively via the handle below.
  const planetsRef = useRef<PlanetPlacement[]>([]);
  const sunRef = useRef<{ x: number; y: number } | null>(null);
  const dimsRef = useRef({ w: width, h: height });
  dimsRef.current = { w: width, h: height };

  useImperativeHandle(ref, () => ({
    update(planets, sunScreen) {
      planetsRef.current = planets;
      sunRef.current = sunScreen;
    },
  }), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = dimsRef.current.w || 1;
    const h = dimsRef.current.h || 1;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0); // transparent — AR overlay's black shows through
    const el = renderer.domElement;
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.pointerEvents = 'none';
    mount.appendChild(el);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    let cancelled = false;

    const entries = new Map<PId, PlanetEntry>();

    const makePlanet = (id: PId): PlanetEntry => {
      const group = new THREE.Group();
      group.visible = false;
      scene.add(group);

      const geom = new THREE.SphereGeometry(1, 64, 64);
      let material: THREE.ShaderMaterial | THREE.MeshBasicMaterial;
      if (id === 'sun') {
        material = new THREE.MeshBasicMaterial({ color: 0xffe7a8 });
      } else {
        material = new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: null },
            uSunDir: { value: new THREE.Vector3(1, 0, 0.4) },
            uAmbient: { value: id === 'moon' ? 0.04 : 0.10 },
            uRim: { value: 0.35 },
          },
          vertexShader: planetVert,
          fragmentShader: planetFrag,
        });
      }
      const body = new THREE.Mesh(geom, material);
      // Tilts (axis tilt — visual flavor, no big claim of accuracy)
      if (id === 'saturn') body.rotation.z = SATURN_TILT_RAD;
      else if (id === 'uranus') body.rotation.z = URANUS_TILT_RAD;
      group.add(body);

      const entry: PlanetEntry = { group, body, material, isSun: id === 'sun' };

      if (id === 'saturn') {
        const ringGeom = new THREE.RingGeometry(1.25, 2.25, 96, 1);
        // RingGeometry's default UVs aren't ideal for a flat ring texture; rebuild them
        // to map texture u = radial.
        const pos = ringGeom.attributes.position;
        const uv = new Float32Array(pos.count * 2);
        const innerR = 1.25;
        const outerR = 2.25;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const r = Math.hypot(x, y);
          const u = (r - innerR) / (outerR - innerR);
          const v = (Math.atan2(y, x) / (Math.PI * 2)) + 0.5;
          uv[i * 2] = u;
          uv[i * 2 + 1] = v;
        }
        ringGeom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xe8d8b0,
          transparent: true,
          opacity: 0.92,
          side: THREE.DoubleSide,
          depthWrite: false,
          alphaTest: 0.02,
        });
        const rings = new THREE.Mesh(ringGeom, ringMat);
        rings.rotation.x = Math.PI / 2;     // lie flat
        // Apply Saturn tilt to the entire group's ring frame
        const ringHolder = new THREE.Group();
        ringHolder.rotation.z = SATURN_TILT_RAD;
        ringHolder.add(rings);
        group.add(ringHolder);
        entry.rings = rings;
        loader.load(
          SATURN_RINGS_URL,
          (tex) => {
            if (cancelled) { tex.dispose(); return; }
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            ringMat.map = tex;
            ringMat.needsUpdate = true;
          },
          undefined,
          () => { /* fall back to solid color */ },
        );
      }

      loader.load(
        TEX_URL[id],
        (tex) => {
          if (cancelled) { tex.dispose(); return; }
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          if (entry.isSun) {
            (entry.material as THREE.MeshBasicMaterial).map = tex;
            (entry.material as THREE.MeshBasicMaterial).needsUpdate = true;
          } else {
            (entry.material as THREE.ShaderMaterial).uniforms.uMap.value = tex;
          }
        },
        undefined,
        () => { /* keep procedural color */ },
      );

      return entry;
    };

    for (const id of PLANET_IDS) entries.set(id, makePlanet(id));

    // Soft additive halo around the sun — adds depth around the bright disc.
    const haloGeom = new THREE.PlaneGeometry(1, 1);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffc879) } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          float a = smoothstep(1.0, 0.0, r);
          a = pow(a, 1.8) * 0.55;
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sunHaloMesh = new THREE.Mesh(haloGeom, haloMat);
    sunHaloMesh.visible = false;
    scene.add(sunHaloMesh);

    stateRef.current = {
      renderer, scene, camera, entries, sunHaloMesh, planetsRef, sunRef, dimsRef,
    };

    // Render loop — keeps planets spinning even when device is still.
    let raf = 0;
    let last = performance.now();
    let docVisible = !document.hidden;
    const tmpSunDir = new THREE.Vector3();

    const stopLoop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const startLoop = () => {
      if (raf || !docVisible || cancelled) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };

    const onVis = () => {
      docVisible = !document.hidden;
      if (docVisible) startLoop();
      else stopLoop();
    };
    document.addEventListener('visibilitychange', onVis);

    const loop = () => {
      if (!docVisible || cancelled) {
        stopLoop();
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      if (!s) return;

      const { w: cw, h: ch } = s.dimsRef.current;
      const placements = s.planetsRef.current;
      const sun = s.sunRef.current;
      const byId = new Map<string, PlanetPlacement>();
      for (const p of placements) byId.set(p.id, p);

      // Hide all
      s.entries.forEach((entry) => { entry.group.visible = false; });
      s.sunHaloMesh.visible = false;

      for (const id of PLANET_IDS) {
        const placement = byId.get(id);
        const entry = s.entries.get(id);
        if (!entry || !placement || !placement.visible) continue;
        entry.group.visible = true;
        // Convert from screen-space (origin top-left) to ortho world (origin center, Y up).
        const wx = placement.screenX - cw / 2;
        const wy = ch / 2 - placement.screenY;
        entry.group.position.set(wx, wy, 0);
        const radius = Math.max(2, placement.size / 2);
        entry.group.scale.setScalar(radius);

        // Spin
        const spin = SPIN_RAD_PER_SEC[id];
        if (spin) entry.body.rotation.y += spin * dt;

        // Sun direction (in view space) — sells the 3D shape and phase.
        if (!entry.isSun) {
          let dx = 1, dy = 0.35;
          if (sun) {
            dx = (sun.x - placement.screenX);
            dy = (placement.screenY - sun.y);
          }
          // Normalize 2D direction, then push some Z so the planet has front-lit highlight too.
          const mag2 = Math.max(1, Math.hypot(dx, dy));
          tmpSunDir.set(dx / mag2, dy / mag2, 0.55).normalize();
          const mat = entry.material as THREE.ShaderMaterial;
          mat.uniforms.uSunDir.value.copy(tmpSunDir);
        }
      }

      // Sun halo follows the sun placement
      const sunPlacement = byId.get('sun');
      if (sunPlacement && sunPlacement.visible) {
        const wx = sunPlacement.screenX - cw / 2;
        const wy = ch / 2 - sunPlacement.screenY;
        s.sunHaloMesh.position.set(wx, wy, -0.5);
        const haloSize = Math.max(12, sunPlacement.size * 3.4);
        s.sunHaloMesh.scale.set(haloSize, haloSize, 1);
        s.sunHaloMesh.visible = true;
      }

      s.renderer.render(s.scene, s.camera);
      raf = requestAnimationFrame(loop);
    };
    startLoop();

    return () => {
      cancelled = true;
      stopLoop();
      document.removeEventListener('visibilitychange', onVis);
      entries.forEach((entry) => {
        entry.body.geometry.dispose();
        if (entry.material instanceof THREE.ShaderMaterial) {
          const tex = entry.material.uniforms.uMap.value as THREE.Texture | null;
          tex?.dispose();
        } else {
          entry.material.map?.dispose();
        }
        entry.material.dispose();
        if (entry.rings) {
          entry.rings.geometry.dispose();
          const m = entry.rings.material as THREE.MeshBasicMaterial;
          m.map?.dispose();
          m.dispose();
        }
      });
      haloGeom.dispose();
      haloMat.dispose();
      renderer.dispose();
      if (el.parentNode === mount) mount.removeChild(el);
      stateRef.current = null;
    };
  }, []);

  // Resize handling — keep ortho aligned with the AR overlay viewport.
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const cw = Math.max(1, width);
    const ch = Math.max(1, height);
    s.renderer.setSize(cw, ch);
    s.camera.left = -cw / 2;
    s.camera.right = cw / 2;
    s.camera.top = ch / 2;
    s.camera.bottom = -ch / 2;
    s.camera.updateProjectionMatrix();
  }, [width, height]);

  return <div ref={mountRef} className="ar-planet3d-layer" aria-hidden="true" />;
});
