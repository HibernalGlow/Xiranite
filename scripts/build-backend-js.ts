import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"

const backendOutput = process.argv[2] ?? path.join("build", "wails", "xiranite-backend.js")
const nodeAppOutput = path.join(path.dirname(backendOutput), "xiranite-node-app-backend.js")
const assetOutputDirectory = path.join(path.dirname(backendOutput), "backend-assets")

await mkdir(path.dirname(backendOutput), { recursive: true })
await rm(assetOutputDirectory, { recursive: true, force: true })
await buildBackend("packages/backend/src/index.ts", backendOutput)
await buildBackend("packages/backend/src/nodeApp.ts", nodeAppOutput)
await copyClipmPythonProject()

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

async function copyClipmPythonProject(): Promise<void> {
  const sourceRoot = path.resolve("packages/nodes/clipm/python")
  const targetRoot = path.join(assetOutputDirectory, "clipm-python")
  await mkdir(targetRoot, { recursive: true })
  await Promise.all([
    cp(path.join(sourceRoot, "pyproject.toml"), path.join(targetRoot, "pyproject.toml")),
    cp(path.join(sourceRoot, "uv.lock"), path.join(targetRoot, "uv.lock")),
    cp(path.join(sourceRoot, "src"), path.join(targetRoot, "src"), {
      recursive: true,
      filter: (source) => !source.split(path.sep).some((part) => part === "__pycache__" || part.endsWith(".pyc")),
    }),
  ])
}
