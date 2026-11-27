# Assets

Terms were read on the source sites on 2026-11-27, following `../CLAUDE.md`.

## Poly Haven textures

Site license, <https://polyhaven.com/license>: all assets are CC0. They can be used for any purpose including commercial work, need no credit or attribution, and can be redistributed. Each asset page below also shows "CC0 License".

The files were fetched through the Poly Haven API. Its terms, <https://github.com/Poly-Haven/Public-API/blob/master/ToS.md>, allow free use including commercial use and require a unique User-Agent on API calls, so `cozy-winter-render/1.0` was sent. Clause 2.5 says the attribution duty covers only live API use inside software and does not apply to downloaded CC0 assets. This project only ships the downloaded files.

| Asset | Page | Used for | Files in `textures/` |
|---|---|---|---|
| Oak Wood Planks | <https://polyhaven.com/a/oak_wood_planks> | Floor | 2k Diffuse, nor_gl, Rough |
| Walnut Veneer | <https://polyhaven.com/a/walnut_veneer> | Coffee table, side table, lamp cabinet | 1k Diffuse, nor_gl, Rough |
| Polar Fleece | <https://polyhaven.com/a/polar_fleece> | Sofa | 1k Diffuse, nor_gl, Rough |
| Rough Linen | <https://polyhaven.com/a/rough_linen> | Pillow weave (normal and roughness only) | 1k Diffuse, nor_gl, Rough |
| Beige Wall 001 | <https://polyhaven.com/a/beige_wall_001> | Interior walls | 2k Diffuse, nor_gl, Rough |
| Snow 02 | <https://polyhaven.com/a/snow_02> | Outdoor ground, roofs, snow banks (normal and roughness only) | 2k Diffuse, nor_gl, Rough |

## Other

| Asset | Source | License | Terms checked |
|---|---|---|---|
| three.js 0.187.0 | npm `three` | MIT | `node_modules/three/LICENSE` |

Everything else (plaid, knit, rug, siding, curtained windows, frost, glow, road tracks) is drawn procedurally in `scene.js`, and the audio is synthesized by `audio.py`.
