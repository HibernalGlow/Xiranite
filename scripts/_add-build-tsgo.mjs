// Temp script: add "build:tsgo": "tsgo -p tsconfig.json" to every package.json
// under packages/* and packages/nodes/*. Idempotent. Delete after PR 3.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const pkgRoots = [join(root, "packages"), join(root, "packages", "nodes")];
let updated = 0;
let skipped = 0;

for (const pkgRoot of pkgRoots) {
  for (const entry of await readdir(pkgRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const f = join(pkgRoot, entry.name, "package.json");
    let txt;
    try { txt = await readFile(f, "utf8"); } catch { continue; }
    const j = JSON.parse(txt);
    if (!j.scripts) j.scripts = {};
    if (j.scripts["build:tsgo"]) { skipped++; continue; }
    // Insert build:tsgo right after build to keep key order readable.
    const next = {};
    for (const [k, v] of Object.entries(j.scripts)) {
      next[k] = v;
      if (k === "build") next["build:tsgo"] = "tsgo -p tsconfig.json";
    }
    // If there was no "build" key, just append.
    if (!next["build:tsgo"]) next["build:tsgo"] = "tsgo -p tsconfig.json";
    j.scripts = next;
    const out = JSON.stringify(j, null, 2) + (txt.endsWith("\n") ? "\n" : "");
    await writeFile(f, out, "utf8");
    updated++;
    console.log("updated", f);
  }
}

console.log(`total updated: ${updated}, skipped: ${skipped}`);
