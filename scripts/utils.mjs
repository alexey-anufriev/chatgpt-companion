import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const distDir = resolve(rootDir, "dist");
export const archivePath = resolve(distDir, "chatgpt-companion.zip");
