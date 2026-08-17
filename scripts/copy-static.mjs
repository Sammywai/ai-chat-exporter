import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const staticDirectory = resolve("static");
const outputDirectory = resolve("dist");

await mkdir(outputDirectory, { recursive: true });
await cp(staticDirectory, outputDirectory, { recursive: true, force: true });
