import { mkdir } from "node:fs/promises"
import path from "node:path"

const outfile = process.argv[2] ?? path.join("build", "wails", "xiranite-backend.js")

await mkdir(path.dirname(outfile), { recursive: true })

const build = Bun.spawn([
  process.execPath,
  "build",
  "packages/backend/src/index.ts",
  "--target",
  "bun",
  "--outfile",
  outfile,
], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

const exitCode = await build.exited
if (exitCode !== 0) {
  process.exit(exitCode)
}
