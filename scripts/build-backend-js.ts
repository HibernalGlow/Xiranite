import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { stageNativeBundleDependencies } from "./lib/backend-native-deps"

const backendOutput = process.argv[2] ?? path.join("build", "wails", "xiranite-backend.js")
const nodeAppOutput = path.join(path.dirname(backendOutput), "xiranite-node-app-backend.js")
const assetOutputDirectory = path.join(path.dirname(backendOutput), "backend-assets")

await mkdir(path.dirname(backendOutput), { recursive: true })
await rm(assetOutputDirectory, { recursive: true, force: true })
await buildBackend("packages/backend/src/index.ts", backendOutput)
await buildBackend("packages/backend/src/nodeApp.ts", nodeAppOutput)
await copyClipmPythonProject()
await stageNativeBundleDependencies({
  importerFile: path.resolve("packages/repository/src/libsql.ts"),
  outputDirectory: path.dirname(backendOutput),
})

async function buildBackend(entrypoint: string, output: string): Promise<void> {
  const build = Bun.spawn([
    process.execPath,
    "build",
    entrypoint,
    "--target",
    "bun",
    // registry-js is the Windows-only registry adapter behind a dynamic import
    // with a literal specifier, so Bun resolves it at build time even when the
    // call site never runs. Its native binary only exists on Windows, so other
    // hosts would fail the bundle; keep it external there instead.
    ...(process.platform === "win32" ? [] : ["--external", "registry-js"]),
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
