# Vendored scanner engines

Self-hosted so `scan.html`'s barcode scanner works offline as a PWA (previously loaded from esm.sh/jsdelivr at runtime).

| File | Source package | Version | License |
|---|---|---|---|
| `barcode-detector.js` | [`barcode-detector`](https://www.npmjs.com/package/barcode-detector) (`dist/es/pure.js`) | 2.3.1 | MIT |
| `zxing_reader.wasm` | [`zxing-wasm`](https://www.npmjs.com/package/zxing-wasm) (`dist/reader/zxing_reader.wasm`) — the actual decoder `barcode-detector` uses internally, loaded via `setZXingModuleOverrides({ locateFile })` | 1.3.4 | MIT |
| `zbar-wasm.mjs` | [`@undecaf/zbar-wasm`](https://www.npmjs.com/package/@undecaf/zbar-wasm) (`dist/index.mjs`, the browser-exports-condition build) | 0.11.0 | LGPL-2.1+ |
| `zbar.wasm` | same package, `dist/zbar.wasm` | 0.11.0 | LGPL-2.1+ |

Do not hand-edit these files — they're copied verbatim from each package's own dist build. To update, re-run `npm pack <package>@<version>`, extract, and replace.
