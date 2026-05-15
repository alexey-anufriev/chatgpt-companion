import { cpSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(rootDir, "dist");

mkdirSync(distDir, { recursive: true });

const filesToCopy = [
    "src/manifest.json",
    "src/options.html",
    "src/options.css",
    "src/sidepanel.html",
    "src/sidepanel.css",
    "src/rules.json",
    "src/icons/icon_16.png",
    "src/icons/icon_32.png",
    "src/icons/icon_48.png",
    "src/icons/icon_128.png"
];

for (const relativePath of filesToCopy) {
    cpSync(resolve(rootDir, relativePath), resolve(distDir, basename(relativePath)));
}
