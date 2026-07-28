import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

const backendOutput = process.argv[2] ?? path.join("build", "wails", "xiranite-backend.js")
const nodeAppOutput = path.join(path.dirname(backendOutput), "xiranite-node-app-backend.js")
const assetOutputDirectory = path.join(path.dirname(backendOutput), "backend-assets")

await mkdir(path.dirname(backendOutput), { recursive: true })
await rm(assetOutputDirectory, { recursive: true, force: true })
await buildBackend("packages/backend/src/index.ts", backendOutput)
await buildBackend("packages/backend/src/nodeApp.ts", nodeAppOutput)

async function buildBackend(entrypoint: string, output: string): Promise<void> {
  const build = Bun.spawn([
    process.execPath,
    "build",
    entrypoint,
    "--target",
    "bun",
    "--outdir",
    path.dirname(output),
    "--entry-naming",
    path.basename(output),
    "--asset-naming",
    "backend-assets/[name]-[hash].[ext]",
  ], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })

  const exitCode = await build.exited
  if (exitCode !== 0) process.exit(exitCode)
}
