import { cpSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(rootDir, "dist");

mkdirSync(distDir, { recursive: true });

const filesToCopy = [
    "src/manifest.json",
    "src/options/index.html",
    "src/options/index.css",
    "src/prompt-picker/index.html",
    "src/prompt-picker/index.css",
    "src/sidepanel/index.html",
    "src/sidepanel/index.css",
    "src/rules.json",
    "src/icons/icon_16.png",
    "src/icons/icon_32.png",
    "src/icons/icon_48.png",
    "src/icons/icon_128.png"
];

for (const relativePath of filesToCopy) {
    const sourcePath = resolve(rootDir, relativePath);
    const outputPath = resolve(distDir, relative("src", relativePath));

    mkdirSync(dirname(outputPath), { recursive: true });
    cpSync(sourcePath, outputPath);
}
