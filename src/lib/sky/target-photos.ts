// Reference photos for finder targets — public-domain NASA / ESA / Hubble
// imagery, downloaded from Wikimedia Commons and shipped from /public so we
// don't rely on third-party hosts at runtime.
//
// Stars (Sirius, Arcturus) intentionally have no entry; their hero falls
// back to the synthesised glyph in PlanetIcon.

export interface TargetPhoto {
  src: string;
  alt: string;
  credit: string;
}

export const TARGET_PHOTOS: Record<string, TargetPhoto> = {
  sun: {
    src: '/sky/targets/sun.jpg',
    alt: 'The Sun in extreme ultraviolet',
    credit: 'NASA / SDO',
  },
  moon: {
    src: '/sky/targets/moon.jpg',
    alt: 'Full Moon, Earth-based telescope',
    credit: 'Gregory H. Revera',
  },
  mercury: {
    src: '/sky/targets/mercury.jpg',
    alt: 'Mercury in true colour',
    credit: 'NASA / JHU APL / MESSENGER',
  },
  venus: {
    src: '/sky/targets/venus.jpg',
    alt: 'Venus cloud tops',
    credit: 'NASA / Mariner 10',
  },
  mars: {
    src: '/sky/targets/mars.jpg',
    alt: 'Mars true colour from Rosetta',
    credit: 'ESA / OSIRIS',
  },
  jupiter: {
    src: '/sky/targets/jupiter.jpg',
    alt: 'Jupiter and the Great Red Spot',
    credit: 'NASA / Hubble',
  },
  saturn: {
    src: '/sky/targets/saturn.jpg',
    alt: 'Saturn during equinox',
    credit: 'NASA / JPL / Cassini',
  },
  uranus: {
    src: '/sky/targets/uranus.jpg',
    alt: 'Uranus from Voyager 2',
    credit: 'NASA / Voyager 2',
  },
  neptune: {
    src: '/sky/targets/neptune.jpg',
    alt: 'Neptune from Voyager 2',
    credit: 'NASA / Voyager 2',
  },
  m31: {
    src: '/sky/targets/m31.jpg',
    alt: 'Andromeda Galaxy (M31) in visible + Hα light',
    credit: 'Adam Evans / public domain',
  },
  m42: {
    src: '/sky/targets/m42.jpg',
    alt: 'Orion Nebula — Hubble 2006 mosaic',
    credit: 'NASA / ESA / Hubble',
  },
  m57: {
    src: '/sky/targets/m57.jpg',
    alt: 'Ring Nebula (M57) — Hubble',
    credit: 'NASA / ESA / Hubble',
  },
};

export function getTargetPhoto(id: string): TargetPhoto | null {
  return TARGET_PHOTOS[id] ?? null;
}

/**
 * Uniform icon set — every target normalised to one apparent size on a common
 * near-black field, so a rail of them reads as equal discs instead of a dozen
 * differently-framed crops. Planets and DSOs are cropped from the photos above;
 * the two bright stars are drawn (a star has no disc to photograph).
 * Regenerate with `node scripts/build-target-icons.mjs`.
 */
export const TARGET_ICONS: Record<string, { src: string; alt: string }> = {
  sun: { src: '/sky/targets/icons/sun.png', alt: 'The Sun' },
  moon: { src: '/sky/targets/icons/moon.png', alt: 'The Moon' },
  mercury: { src: '/sky/targets/icons/mercury.png', alt: 'Mercury' },
  venus: { src: '/sky/targets/icons/venus.png', alt: 'Venus' },
  mars: { src: '/sky/targets/icons/mars.png', alt: 'Mars' },
  jupiter: { src: '/sky/targets/icons/jupiter.png', alt: 'Jupiter' },
  saturn: { src: '/sky/targets/icons/saturn.png', alt: 'Saturn' },
  uranus: { src: '/sky/targets/icons/uranus.png', alt: 'Uranus' },
  neptune: { src: '/sky/targets/icons/neptune.png', alt: 'Neptune' },
  sirius: { src: '/sky/targets/icons/sirius.png', alt: 'Sirius' },
  arcturus: { src: '/sky/targets/icons/arcturus.png', alt: 'Arcturus' },
  m31: { src: '/sky/targets/icons/m31.png', alt: 'Andromeda Galaxy' },
  m42: { src: '/sky/targets/icons/m42.png', alt: 'Orion Nebula' },
  m57: { src: '/sky/targets/icons/m57.png', alt: 'Ring Nebula' },
};

export function getTargetIcon(id: string): { src: string; alt: string } | null {
  return TARGET_ICONS[id] ?? null;
}
