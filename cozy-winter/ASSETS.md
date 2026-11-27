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

## tevy 3D models

Site terms, <https://tevy.dev/> and <https://tevy.dev/docs>: all assets are CC0 1.0, free for any use including commercial use and redistribution, with no attribution required. The asset page below also shows "CC0 1.0" (checked on 2026-11-28).

| Asset | Page | Used for | File in `models/` |
|---|---|---|---|
| Spooky Dead Tree (v1, LOD1) | <https://tevy.dev/models/spooky-tree> | Two foreground leafless trees outside the window | `spooky-tree-lod1.glb` |

## Other

| Asset | Source | License | Terms checked |
|---|---|---|---|
| three.js 0.187.0 | npm `three` | MIT | `node_modules/three/LICENSE` |

Everything else (plaid, knit, rug, siding, curtained windows, frost, glow, road tracks) is drawn procedurally in `scene.js`, and the audio is synthesized by `audio.py`.
| Two-Storey Wooden House (v2, LOD0) | https://tevy.dev/models/village-house | 窓外の住宅（`models/village-house-lod0.glb`） | CC0 1.0 | 2026-11-28 |
| Falu Red Cottage (v2, LOD0) | https://tevy.dev/models/red-cottage | 窓外の住宅（`models/red-cottage-lod0.glb`） | CC0 1.0 | 2026-11-28 |
| Cast-Iron Wood Stove (v2, LOD1) | https://tevy.dev/models/wood-stove | 室内の薪ストーブ（`models/wood-stove-lod1.glb`） | CC0 1.0 | 2026-11-28 |
| Gift Box Set (v1, LOD1) | https://tevy.dev/models/gift-box-set | ツリー下のプレゼント箱（`models/gift-box-set-lod1.glb`） | CC0 1.0 | 2026-11-28 |
| Dried Flowers in Jug (v1, LOD0) | https://tevy.dev/models/dried-flowers-in-jug | テーブル上のドライフラワー花瓶（`models/dried-flowers-lod0.glb`） | CC0 1.0 | 2026-11-28 |
| Table Lamp (v1, LOD0) | https://tevy.dev/models/table-lamp | ソファ横のテーブルランプ（`models/table-lamp-lod0.glb`） | CC0 1.0 | 2026-11-28 |
| Snowy Norway Spruce (v1, LOD2) | https://tevy.dev/models/snowy-spruce | 窓外の雪付き針葉樹（`models/snowy-spruce-lod2.glb`） | CC0 1.0 | 2026-11-28 |
| Book Row with Leaning Book (v1, LOD1) | https://tevy.dev/models/book-row-with-leaning-book | 窓下ベンチの本（`models/books-lod1.glb`） | CC0 1.0 | 2026-11-28 |
