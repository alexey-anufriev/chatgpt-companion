import { rmSync } from "node:fs";
import { distDir } from "./utils.mjs";

rmSync(distDir, { recursive: true, force: true });
