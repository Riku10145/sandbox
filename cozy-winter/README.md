# Cozy Winter Window

A 10-second ambience clip rendered with three.js 0.187.0. A warm living room with candles, a lit tree and a wood stove looks out through a big window onto a snowy street at dusk.

## Render

```sh
npm install
python3 audio.py out/ambience.wav
node record.mjs
```

The clip is written to `out/cozy-winter.mp4` at 1920x1080, 30 fps, with a synthesized fire-crackle and wind track.

`node record.mjs --still 0.5,5` writes single frames to `out/still-<t>.png`. Add `--cam x,y,z,tx,ty,tz` to look at one spot up close, for example `--cam 2.6,0.9,0.6,3.95,0.6,-0.75` for the stove.

`--fx` picks the realism effects. The default is `shadow,gtao,env`. Use `--fx none` for the flat look, or one name to see a single effect.

To watch it live, serve this folder over HTTP and open `index.html?preview`.

## Credits

Floor, wood, fabric, wall and snow textures are CC0 assets from [Poly Haven](https://polyhaven.com). Credit is not required, but they deserve it. See `ASSETS.md` for the list and the license check.

## How it works

`scene.js` builds everything procedurally and exposes `window.renderAt(t)`. Every animated value is a pure function of `t`, so each frame is reproducible. `record.mjs` serves the folder, drives headless Chromium frame by frame, and pipes PNGs into ffmpeg together with the audio from `audio.py`.
