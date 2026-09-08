# Solar system 3D texture credits

Textures in `planets/` are used on equirectangular spheres in `/solar-system`
and in the sky finder's AR planet layer.

Each body ships at two resolutions: `<body>.jpg` at 2048×1024, loaded on first
paint, and `<body>-4k.jpg` at 4096×2048, fetched only once the body grows large
enough on screen to show the difference (see `planet-texture-urls.ts`). Rebuild
both with `node scripts/build-planet-textures.mjs`.

| Body | Files | Primary source |
|------|-------|----------------|
| Sun | `sun.jpg`, `sun-4k.jpg` | Solar System Scope 8K (SDO-derived) |
| Mercury | `mercury.jpg`, `mercury-4k.jpg` | Solar System Scope 8K (MESSENGER global mosaic) |
| Venus | `venus.jpg`, `venus-4k.jpg` | Solar System Scope 4K cloud-top atmosphere |
| Earth | `earth.jpg`, `earth-4k.jpg` | Solar System Scope 8K day map (NASA Blue Marble–derived) |
| Earth (night) | `earth-night.jpg` | Solar System Scope 8K (NASA Black Marble city lights) |
| Earth (clouds) | `earth-clouds.jpg` | Solar System Scope 8K (NASA satellite cloud composite) |
| Moon | `moon.jpg`, `moon-4k.jpg` | Solar System Scope 8K (NASA LRO global map) |
| Mars | `mars.jpg`, `mars-4k.jpg` | Solar System Scope 8K (Viking / MOLA-derived) |
| Jupiter | `jupiter.jpg`, `jupiter-4k.jpg` | Solar System Scope 8K (Cassini / Juno–derived) |
| Saturn | `saturn.jpg`, `saturn-4k.jpg`, `saturn-rings.png` | Solar System Scope 8K (Cassini-derived) |
| Uranus | `uranus.jpg` | Solar System Scope 2K (Voyager 2–derived) |
| Neptune | `neptune.jpg` | Solar System Scope 2K (Voyager 2–derived) |
| Pluto | `pluto.jpg` | [NASA 3D Resources — Pluto](https://github.com/nasa/NASA-3D-Resources) (New Horizons) |

The Solar System Scope set is by [INOVE](https://www.solarsystemscope.com/textures/),
built from NASA mission imagery and elevation data, and is licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Files were downloaded
from Wikimedia Commons and re-encoded; no other change was made.

Uranus, Neptune and Pluto have no 4K source. Their surfaces are carried at close
range by the procedural cloud and relief detail in `src/lib/solar-system/planet-textures.ts`.

Gallery reference: [Our Solar System Images — NASA Science](https://science.nasa.gov/gallery/our-solar-system-images/)

NASA media usage: [NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)
