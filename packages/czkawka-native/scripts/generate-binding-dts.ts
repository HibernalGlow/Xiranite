import { access, copyFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { constants } from "node:fs"
import { dirname, join, delimiter, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const packageDirectory = resolve(scriptDirectory, "..")
const repositoryDirectory = resolve(packageDirectory, "..", "..")
const nativeDirectory = resolve(repositoryDirectory, "native")
const targetDirectory = resolve(nativeDirectory, "target")
const generatedDeclaration = resolve(packageDirectory, "generated", "binding.generated.d.ts")
const declarationName = "binding.generated.d.ts"
const checkOnly = process.argv.includes("--check")

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function withPath(existing: string | undefined, next: string): string {
  return existing ? `${next}${delimiter}${existing}` : next
}

async function generate(): Promise<void> {
  const napiCli = resolve(repositoryDirectory, "node_modules", "@napi-rs", "cli", "dist", "cli.js")
  if (!await exists(napiCli)) {
    throw new Error("@napi-rs/cli is unavailable. Run bun install before generating Czkawka Node-API declarations.")
  }

  const outputDirectory = await mkdtemp(join(tmpdir(), "xiranite-czkawka-napi-dts-"))
  const dav1dDirectory = join(targetDirectory, "dav1d")
  const environment = {
    ...process.env,
    CARGO_BUILD_JOBS: "1",
    PATH: withPath(process.env.PATH, join(dav1dDirectory, "bin")),
    PKG_CONFIG_PATH: withPath(process.env.PKG_CONFIG_PATH, join(dav1dDirectory, "lib", "pkgconfig")),
  }
  const sccache = Bun.which("sccache")
  if (sccache) environment.RUSTC_WRAPPER = sccache

  try {
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        napiCli,
        "build",
        "--cwd", nativeDirectory,
        "--manifest-path", "Cargo.toml",
        "--package-json-path", "../packages/czkawka-native/package.json",
        "--package", "xiranite-czkawka-node",
        "--release",
        "--target-dir", targetDirectory,
        "--output-dir", outputDirectory,
        "--dts", declarationName,
      ],
      cwd: repositoryDirectory,
      env: environment,
      stdout: "inherit",
      stderr: "inherit",
    })
    if (await child.exited !== 0) throw new Error("napi-rs declaration generation failed.")

    const generatedPath = join(outputDirectory, declarationName)
    if (!await exists(generatedPath)) throw new Error(`napi-rs did not create ${generatedPath}.`)
    if (!checkOnly) {
      await copyFile(generatedPath, generatedDeclaration)
      return
    }

    if (!await exists(generatedDeclaration)) {
      throw new Error(`Missing committed declaration ${generatedDeclaration}. Run bun run generate:binding-dts.`)
    }
    const [expected, actual] = await Promise.all([readFile(generatedDeclaration), readFile(generatedPath)])
    if (!expected.equals(actual)) {
      throw new Error("Czkawka Node-API declaration drift detected. Run bun run generate:binding-dts and review the generated diff.")
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true })
  }
}

await generate()
