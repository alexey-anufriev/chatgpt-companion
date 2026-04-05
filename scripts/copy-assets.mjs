import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(rootDir, "dist");

mkdirSync(distDir, { recursive: true });

const filesToCopy = [
    "src/manifest.json",
    "src/sidepanel.html",
    "src/sidepanel.css",
    "src/rules.json"
];

for (const relativePath of filesToCopy) {
    cpSync(resolve(rootDir, relativePath), resolve(distDir, relativePath.replace(/^src\//, "")));
}

cpSync(resolve(rootDir, "src/icons"), distDir, { recursive: true });
