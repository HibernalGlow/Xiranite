import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = "D:/1VSCODE/Projects/Xiranite"
const pkgRoots = [join(root, "packages"), join(root, "packages", "nodes")]
let updated = 0

for (const pkgRoot of pkgRoots) {
  for (const entry of await readdir(pkgRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const f = join(pkgRoot, entry.name, "tsconfig.json")
    let txt
    try {
      txt = await readFile(f, "utf8")
    } catch {
      continue
    }
    const j = JSON.parse(txt)
    const co = j.compilerOptions
    if (!co) continue
    if (JSON.stringify(co.types) === JSON.stringify(["node"])) continue
    co.types = ["node"]
    const out = JSON.stringify(j, null, 2) + (txt.endsWith("\n") ? "\n" : "")
    await writeFile(f, out, "utf8")
    updated++
    console.log("updated", f.replace(root + "/", ""))
  }
}
console.log(`total updated: ${updated}`)
