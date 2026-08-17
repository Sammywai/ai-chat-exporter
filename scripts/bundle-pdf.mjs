import { build } from "esbuild";

await build({
  entryPoints: ["src/renderers/pdf.ts"],
  outfile: "dist/renderers/pdf.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none"
});

await build({
  entryPoints: ["src/popup/popup.ts"],
  outfile: "dist/popup/popup.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none"
});

await build({
  entryPoints: ["pdfjs-dist/build/pdf.worker.mjs"],
  outfile: "dist/popup/pdf.worker.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none"
});
