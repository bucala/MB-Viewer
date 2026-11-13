# MB Viewer

A multiplatform CAD viewer — one React codebase targeting **Web**, **Windows desktop** (Tauri) and **Android** (Capacitor).

Opens **STEP / IGES / BREP** (via OpenCASCADE compiled to WebAssembly), plus **STL / OBJ / GLB**, and provides an assembly tree, an interactive View Cube, material presets and measurement tools in a minimalist, model-first UI.

![Layout: assembly tree · 3D viewport · toolbar](docs/screenshot.png)

## Features

- **Project tree (left panel)** — collapsible assembly hierarchy read from the CAD product structure, with per-node show/hide and per-node **transparency** (ghost mode, strength configurable in Settings; both apply to the whole subtree), search filtering and selection sync with the viewport.
- **3D canvas + View Cube + axes** — orbit/pan/zoom viewport with an interactive navigation cube (top-right, localized bold labels; clicking faces/edges/corners smoothly animates the camera) and an **XYZ orientation triad** (bottom-right). **Perspective or parallel** (orthographic) projection, switchable in Settings.
- **Materials & appearance** — presets (*Original, Matte Plastic, Shiny Plastic, Metal, Glass*) and a color palette, applied to the whole model or to the selected part/sub-assembly (material inheritance follows the tree).
- **Measurement tools** — surface-based measuring on faces *and* feature edges: a **cylinder face or circular edge → diameter**, a **cone → apex angle**, two **flat faces → distance** (parallel, along the normal) **or angle** (non-parallel), two **straight edges → distance or angle**, plus mixed pairs (face–edge, hole axis–face, hole center–face…). The **Auto** tool does all of this from context; the dedicated **Distance / Angle / Diameter** tools bias the same picks toward their result (Diameter keeps a 3-point circle fallback for free-form meshes), and a separate **point-to-point** tool measures between two snapped points. For STEP/IGES/BREP the click is resolved to its **B-rep face** (OpenCASCADE reports which triangles form each face) and the whole face is fitted from its exact vertex normals — diameters are exact; on regression samples (CAx-IF models) 99.9 % of clicks on holes/shafts give the true diameter and flat faces never read as cylinders. Mesh-only formats (STL/OBJ/GLB) recover geometry from the tessellation (facet-normal analysis, axis fits grown around the circumference, feature-edge chaining + line/circle fits); a diameter fitted over a narrow arc is marked **≈**. Values follow the UI language's number format. In a section view, picking ignores the cut-away half and clicks on the cut face land on the section plane. Raycasting is BVH-accelerated (`three-mesh-bvh`).
- **Settings menu** — language (**Slovak** default / English), skin (**white / gray / black**), projection mode, display quality, **CAD tessellation** density (coarse / standard / fine), transparency strength, OS **file-association** opt-ins (applied immediately on Windows via per-user registry entries — only the extensions you toggle; a default app you chose elsewhere is never reset — and also registered by the installer), **About & licenses** (the LGPL texts of OpenCASCADE and occt-import-js), quick actions (sample assembly, grid), with Apply/Reset.
- **Large models** — files are parsed and their picking BVHs built in Web Workers, so the UI never freezes (a 1 M-triangle STL loads with no main-thread task over ~150 ms); a load can be **cancelled**, and opening another file supersedes the one still loading. The tree is virtualized (thousands of parts stay responsive), the scene renders **on demand** only, and section caps are drawn only for the parts the plane cuts.
- **Keyboard & touch** — the tree is a keyboard-operable `tree` (arrows, Home/End, Enter); popovers close on Esc; on phones the toolbar is icon-only, the tree starts closed and its row actions are always visible.
- Drag & drop or file-picker loading, adaptive ground grid, camera auto-fit with scale-aware clipping planes, built-in procedural sample assembly.

## Tech stack

| Layer | Choice |
|---|---|
| UI | React 19 + TypeScript + Vite + Tailwind CSS 4 |
| 3D | three.js via `@react-three/fiber` + `@react-three/drei` |
| CAD parsing | `occt-import-js` (OpenCASCADE → WASM) in a Web Worker |
| Picking perf | `three-mesh-bvh` |
| State | `zustand` |
| Desktop | Tauri 2 (WebView2 on Windows — ~10 MB installer, no bundled Chromium) |
| Mobile | Capacitor 8 (Android WebView) |

## How heavy STEP/IGES files are handled (WASM strategy)

STEP and IGES usually describe exact **B-rep** surfaces rather than GPU-ready triangles, although STEP can also contain already-faceted solids. Analytic models need a real CAD kernel: MB Viewer uses [OpenCASCADE](https://dev.opencascade.org/) compiled to WebAssembly (`occt-import-js`), which parses the file **and** tessellates it into triangle meshes, preserving the assembly hierarchy and colors.

The pipeline is designed around three constraints — parse times of seconds-to-minutes, a 7.6 MB WASM binary, and identical behavior across web/desktop/mobile shells:

1. **CAD import runs in a Web Worker** (`public/occt-worker.js`). The file bytes are `postMessage`-**transferred** (zero-copy) into the worker, and the resulting positions/normals/indices are **transferred** back. Standalone, unstyled, millimeter `FACETED_BREP` models made entirely of triangles are read directly by `public/step-faceted.js`, without rebuilding their already-tessellated faces in a CAD kernel. Unsupported geometry, units, styles and assembly placements fall back to OpenCASCADE; an empty engine result is reported as an error instead of publishing a blank model.
2. **The WASM runtime stays out of the bundler.** The worker is a *classic* worker that `importScripts()`s the Emscripten UMD build verbatim; `scripts/copy-occt.mjs` copies `occt-import-js.{js,wasm}` into `public/vendor/occt/` on `npm install`. Vite never sees the Emscripten bundle, so dev, production, Tauri and Capacitor builds all load it the same way — and the 7.6 MB WASM is fetched **lazily**, only when an import needs the general CAD kernel. App startup and directly imported faceted models pay nothing.
3. **Meshes arrive render-ready.** A second, bundled worker (`src/core/loaders/geometry.worker.ts`) builds every picking BVH (`indirect`, so triangle order — and with it the B-rep face ranges — is preserved) and parses STL/OBJ; GLB is parsed on the main thread (textures) with its BVHs built off-thread. The main thread only wraps the transferred arrays into `THREE.BufferGeometry`. Bodies whose faces carry different colors are split per color, so STEP face colors survive. An idle CAD worker is terminated after 30 s to return the WASM heap.

STL/STEP/IGES geometry is treated as **Z-up** (CAD convention) and displayed under a rigid −90° X rotation to three.js Y-up — rigid, so world-space measurements (distances/angles/diameters, in mm) are unaffected.

## Project structure

```
MB-Viewer/
├─ index.html
├─ package.json / vite.config.ts / tsconfig.json
├─ capacitor.config.ts            # Android shell config
├─ public/
│  ├─ occt-worker.js              # classic worker: OpenCASCADE WASM host
│  ├─ step-faceted.js             # conservative triangular FACETED_BREP fast path
│  └─ vendor/occt/                # WASM runtime (copied on npm install, gitignored)
├─ scripts/
│  ├─ copy-occt.mjs               # node_modules → public/vendor/occt
│  ├─ icon-lib.mjs                # dependency-free icon rasterizer (shared)
│  ├─ gen-icons.mjs               # desktop icon set (PNGs + multi-size ICO)
│  └─ android-icons.mjs           # Android launcher mipmaps + adaptive icon
├─ src/
│  ├─ main.tsx                    # entry: BVH install + React root
│  ├─ app/App.tsx                 # shell: layout, drag&drop, overlays, hotkeys
│  ├─ store/viewerStore.ts        # zustand: model, tree state, tools, materials
│  ├─ core/                       # UI-independent domain logic
│  │  ├─ types.ts                 # LoadedModel, ModelNode, Measurement, …
│  │  ├─ scene.ts                 # tree traversal → render entries, world box
│  │  ├─ bvh.ts                   # three-mesh-bvh raycast install
│  │  ├─ sample.ts                # procedural demo assembly
│  │  ├─ loaders/
│  │  │  ├─ openModelFile.ts      # extension routing, file picker
│  │  │  ├─ occtLoader.ts         # occt worker RPC (cancel, idle release) → LoadedModel
│  │  │  ├─ geometry.worker.ts    # STL/OBJ parsing + indirect BVH builds, off-thread
│  │  │  ├─ geometryWorker.ts     # its RPC client
│  │  │  ├─ meshLoaders.ts        # STL / OBJ / GLB
│  │  │  └─ finalizeModel.ts      # indexing, bounds, stats
│  │  ├─ materials/presets.ts     # presets + memoized material resolution
│  │  ├─ measure/                 # surface/edge classification + pairing math
│  │  ├─ desktop.ts               # Tauri glue: launch files, associations
│  │  └─ mobile.ts                # Capacitor glue: fullscreen (status bar)
│  └─ components/
│     ├─ layout/                  # Toolbar, Sidebar (assembly tree), StatusBar
│     ├─ viewport/                # Canvas, SceneModel, ViewCube, CameraRig,
│     │                           # MeasureOverlay, StudioEnvironment, grid
│     └─ ui/icons.tsx             # inline SVG icon set
└─ src-tauri/                     # Windows/desktop shell (Tauri 2)
   ├─ tauri.conf.json / Cargo.toml
   └─ src/{main.rs, lib.rs,       # launch-file commands, single instance,
           associations.rs}       # runtime file associations (HKCU registry)
```

## Getting started

```bash
npm install        # also copies the occt WASM runtime into public/
npm run dev        # web app on http://localhost:5173
npm run build      # typecheck + production bundle in dist/
npm test           # faceted STEP fixtures, worker regressions, measuring accuracy on real STEP models
```

No model at hand? Click **Sample** in the toolbar.

### Windows desktop (Tauri)

Requires [Rust](https://rustup.rs) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (WebView2 is preinstalled on Windows 11).

```bash
npm run desktop:dev      # dev app with hot reload
npm run desktop:build    # installer (NSIS/MSI) in src-tauri/target/release/bundle/
```

App icons are committed and reproducible via `npm run icons` (`scripts/gen-icons.mjs` renders the branding with no image dependencies). Double-clicking a file associated with MB Viewer opens it directly; when the app is already running, the file is routed into the existing window (single-instance).

### Android (Capacitor)

Requires Android Studio + SDK. For live reload from a phone, start the dev server with `VITE_LAN=1 npm run dev` — by default it only listens on localhost.

```bash
npx cap add android      # once — generates the android/ project (gitignored)
npm run android:sync     # build web assets + sync into the native project
npm run android:open     # open in Android Studio, run on device/emulator
```

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`: typecheck, `npm test` (including the measuring-accuracy regression on real STEP tessellations), a production build, and on Windows the thumbnail-provider tests plus a compile check of the Tauri shell.

## CI installer builds

`.github/workflows/build.yml` is a manually triggered workflow (**Actions → Build installers → Run workflow**) with a platform picker (`all` / `android` / `windows`). The **Android** job generates the Capacitor project and produces a debug **`.apk`**; the **Windows** job compiles the Tauri shell and produces an **`.msi`**. Both are uploaded as downloadable artifacts on the run's Summary page.

## Notes & roadmap

- Units are assumed **millimeters** (OpenCASCADE normalizes STEP/IGES lengths to mm on import).
- On free-form meshes (organic STL sculpts) the surface classifiers stay quiet — use the 3-point diameter fallback and the point-to-point tool there.
- Windows may protect a user-chosen default app (`UserChoice`): MB Viewer then still appears in the extension's **Open with** list, and becomes the default where none was set. Turning an association off only clears a `UserChoice` that points at MB Viewer.
- The desktop app runs under a Content Security Policy; `'unsafe-eval'` is allowed because occt-import-js (Emscripten embind) generates functions at runtime. The shell reads only files the OS handed to it (launch arguments / forwarded double-clicks).
- Not done yet: merging static parts into batched draw calls (one draw call per part today), code-signed MSI and a release-signed APK (need certificates).
- `.glb` should be self-contained and uncompressed (no Draco/KTX2 decoders wired up yet); multi-material meshes use their first material.
- Ideas next: exploded views, mass properties, edge/silhouette rendering, SpaceMouse (WebHID), measurement export.

## License

MIT — see [LICENSE](LICENSE).
