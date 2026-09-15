// J0 step 1: any missing binary is reported by name with the install command.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const problems = [];
for (const bin of ["ffmpeg", "ffprobe"]) {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" });
  } catch {
    problems.push(`${bin} is not installed.  Install: sudo apt-get install -y ffmpeg   (macOS: brew install ffmpeg)`);
  }
}
if (!fs.existsSync(".env")) {
  fs.copyFileSync(".env.example", ".env");
  console.log("preflight: created .env from .env.example (SNAPSHOT_MODE=false; set to true to run fully offline)");
}
if (problems.length) {
  for (const p of problems) console.error(`preflight: ${p}`);
  process.exit(1);
}
console.log("preflight: ffmpeg and ffprobe found");
