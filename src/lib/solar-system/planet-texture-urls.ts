import type { SolarBodyId } from '@/lib/solar-system/ephemeris';

/**
 * Equirectangular planet maps for the 3D solar system.
 * Sources: NASA 3D Resources (GitHub), NASA SVS Blue Marble, NASA/Caltech JPL maps,
 * and mission-based hero assets under `public/hero/planets`.
 *
 * @see public/solar-system/CREDITS.md
 */
export const NASA_PLANET_TEXTURE_URL: Record<SolarBodyId, string> = {
  sun: '/solar-system/planets/sun.jpg',
  mercury: '/solar-system/planets/mercury.jpg',
  venus: '/solar-system/planets/venus.jpg',
  earth: '/solar-system/planets/earth.jpg',
  mars: '/solar-system/planets/mars.jpg',
  jupiter: '/solar-system/planets/jupiter.jpg',
  saturn: '/solar-system/planets/saturn.jpg',
  uranus: '/solar-system/planets/uranus.jpg',
  neptune: '/solar-system/planets/neptune.jpg',
  pluto: '/solar-system/planets/pluto.jpg',
};

/**
 * 4096x2048 versions of the maps above, fetched only once a body grows large
 * enough on screen to show the difference. The base maps load at 2K so first
 * paint stays quick; these keep the surface sharp when you fly right up to a
 * planet instead of handing you a magnified 2K blur.
 *
 * Uranus, Neptune and Pluto have no entry — no higher-resolution source
 * exists for them, and their surfaces are carried by the procedural cloud
 * and relief detail in `planet-textures.ts`.
 */
export const NASA_PLANET_DETAIL_URL: Partial<Record<SolarBodyId, string>> = {
  sun: '/solar-system/planets/sun-4k.jpg',
  mercury: '/solar-system/planets/mercury-4k.jpg',
  venus: '/solar-system/planets/venus-4k.jpg',
  earth: '/solar-system/planets/earth-4k.jpg',
  mars: '/solar-system/planets/mars-4k.jpg',
  jupiter: '/solar-system/planets/jupiter-4k.jpg',
  saturn: '/solar-system/planets/saturn-4k.jpg',
};

export const NASA_TEXTURE_IDS = Object.keys(NASA_PLANET_TEXTURE_URL) as SolarBodyId[];
