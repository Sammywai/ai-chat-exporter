import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const staticDirectory = resolve("static");
const outputDirectory = resolve("dist");

await mkdir(outputDirectory, { recursive: true });
await cp(staticDirectory, outputDirectory, { recursive: true, force: true });

// The browser bundles strip license comments. Ship the complete notices separately.
const licenseDirectory = resolve(outputDirectory, "licenses");
await mkdir(licenseDirectory, { recursive: true });

const dependencies = [
  ["pdf-lib", ["LICENSE.md"]],
  ["@pdf-lib/fontkit", []],
  ["pdfjs-dist", ["LICENSE"]],
  ["@pdf-lib/standard-fonts", ["LICENSE.md"]],
  ["@pdf-lib/upng", ["LICENSE"]],
  ["pako", ["LICENSE"]],
  ["tslib", ["LICENSE.txt", "CopyrightNotice.txt"]]
];
const packages = [];

for (const [name, sourceFiles] of dependencies) {
  const directory = resolve("node_modules", name);
  const metadata = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  const files = [];
  for (const sourceFile of sourceFiles) {
    const destination = `${name.replaceAll("@", "").replaceAll("/", "-")}-${sourceFile}`;
    await cp(resolve(directory, sourceFile), resolve(licenseDirectory, destination));
    files.push(destination);
  }
  if (name === "@pdf-lib/fontkit") {
    if (metadata.version !== "1.1.1") {
      throw new Error("Review Fontkit's embedded notices before packaging a new version.");
    }
    const destination = "fontkit-NOTICES.md";
    await cp(resolve("THIRD_PARTY_NOTICES.md"), resolve(licenseDirectory, destination));
    files.push(destination);
  }
  packages.push({ name, version: metadata.version, license: metadata.license, files });
}

const pakoSource = await readFile(resolve("node_modules/pako/lib/zlib/inflate.js"), "utf8");
const zlibNotice = pakoSource.match(/(?:^\/\/.*\r?\n)+/m)?.[0];
if (!zlibNotice?.includes("Jean-loup Gailly") || !zlibNotice.includes("This notice may not be removed")) {
  throw new Error("The bundled pako zlib notice needs review.");
}
await writeFile(resolve(licenseDirectory, "pako-zlib-NOTICE.txt"), zlibNotice);
packages.find(({ name }) => name === "pako").files.push("pako-zlib-NOTICE.txt");

const pdfjsSource = await readFile(resolve("node_modules/pdfjs-dist/build/pdf.mjs"), "utf8");
const pdfjsNotice = pdfjsSource.match(/^\/\*\*[\s\S]*?\*\//)?.[0];
if (!pdfjsNotice?.includes("Mozilla Foundation") || !pdfjsNotice.includes("Apache License")) {
  throw new Error("The bundled PDF.js copyright notice needs review.");
}
await writeFile(resolve(licenseDirectory, "pdfjs-dist-NOTICE.txt"), `${pdfjsNotice}\n`);
packages.find(({ name }) => name === "pdfjs-dist").files.push("pdfjs-dist-NOTICE.txt");

await writeFile(resolve(licenseDirectory, "manifest.json"), `${JSON.stringify({ packages }, null, 2)}\n`);
for (const file of ["LICENSE.md", "PRIVACY.md", "THIRD_PARTY_NOTICES.md"]) {
  await cp(resolve(file), resolve(outputDirectory, file));
}
