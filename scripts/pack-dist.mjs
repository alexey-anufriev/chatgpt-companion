import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { archivePath, distDir } from "./utils.mjs";

rmSync(archivePath, { force: true });

execFileSync("zip", ["-r", archivePath, "."], {
    cwd: distDir,
    stdio: "inherit"
});
