import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const licenseManifest = JSON.parse(await readFile(new URL("../dist/licenses/manifest.json", import.meta.url), "utf8"));

test("the extension package preserves complete license documents and required attributions", async () => {
  for (const file of ["LICENSE.md", "PRIVACY.md", "THIRD_PARTY_NOTICES.md"]) {
    assert.deepEqual(
      await readFile(new URL(`../dist/${file}`, import.meta.url)),
      await readFile(new URL(`../${file}`, import.meta.url))
    );
  }
  assert.deepEqual(
    await readFile(new URL("../dist/assets/NotoSansSC-LICENSE.txt", import.meta.url)),
    await readFile(new URL("../static/assets/NotoSansSC-LICENSE.txt", import.meta.url))
  );

  for (const { name, version, files } of licenseManifest.packages) {
    const installed = JSON.parse(await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"));
    assert.equal(version, installed.version, `License inventory version for ${name}`);
    assert.ok(files.length > 0, `No license document for ${name}`);
    for (const file of files) {
      const document = await readFile(new URL(`../dist/licenses/${file}`, import.meta.url));
      const notice = document.toString("utf8");
      assert.ok(notice.length > 200, `Truncated notice: ${file}`);
      assert.match(notice, /permission|license|redistribution/i, `Missing terms: ${file}`);
      if (name === "@pdf-lib/fontkit") {
        assert.deepEqual(document, await readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url)));
      } else if (!file.endsWith("-NOTICE.txt")) {
        const prefix = `${name.replaceAll("@", "").replaceAll("/", "-")}-`;
        assert.deepEqual(document, await readFile(new URL(`../node_modules/${name}/${file.slice(prefix.length)}`, import.meta.url)));
      }
    }
  }

  const fontkit = await readFile(new URL("../dist/licenses/fontkit-NOTICES.md", import.meta.url), "utf8");
  for (const attribution of ["Andrew Dillon", "Devon Govett", "Google Inc.", "Joyent", "Fair Oaks Labs", "Paul Vorbach", "Niklas von Hertzen"]) {
    assert.ok(fontkit.includes(attribution), `Missing embedded Fontkit attribution: ${attribution}`);
  }
  const zlib = await readFile(new URL("../dist/licenses/pako-zlib-NOTICE.txt", import.meta.url), "utf8");
  assert.match(zlib, /Jean-loup Gailly and Mark Adler/);
  assert.match(zlib, /This notice may not be removed or altered/);
  const pdfjs = await readFile(new URL("../dist/licenses/pdfjs-dist-NOTICE.txt", import.meta.url), "utf8");
  assert.match(pdfjs, /Mozilla Foundation/);
  assert.match(pdfjs, /Apache License, Version 2\.0/);
});

test("license inventory covers every npm package used by production browser bundles", async () => {
  const results = await Promise.all([
    "src/renderers/pdf.ts",
    "src/popup/popup.ts",
    "pdfjs-dist/build/pdf.worker.mjs"
  ].map((entryPoint) => build({
    absWorkingDir: projectDirectory,
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  })));
  const includedPackages = new Set();
  for (const result of results) {
    for (const input of Object.keys(result.metafile.inputs)) {
      const name = input.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1];
      if (name) includedPackages.add(name);
    }
  }
  assert.deepEqual(
    [...includedPackages].sort(),
    licenseManifest.packages.map(({ name }) => name).sort(),
    "Review and package notices whenever bundled dependencies change."
  );
});
