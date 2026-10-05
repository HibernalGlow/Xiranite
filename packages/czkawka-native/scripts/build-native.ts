import { existsSync, statSync } from "node:fs"
import { copyFile, mkdir } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** First executable on `PATH`; the optional tools below (sccache, pkgconf) are probed, not assumed. */
function which(binary: string): string | null {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      const candidate = join(directory, binary + extension)
      if (!existsSync(candidate)) continue
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        /* An unreadable PATH entry is skipped, which is what `which` does. */
      }
    }
  }
  return null
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const nativeRoot = join(workspaceRoot, "native")
const profile = process.argv.includes("--debug") ? "debug" : "release"
const args = ["build", "-p", "xiranite-czkawka-node"]
if (profile === "release") args.push("--release")
args.push("-j", "1")
const sccache = which("sccache")
const rustEnv = sccache && !process.env.RUSTC_WRAPPER ? { RUSTC_WRAPPER: sccache } : {}

const dav1dRoot = join(nativeRoot, "target", "dav1d")
const dav1dArchive = join(nativeRoot, "vendor", "dav1d-windows-x64.zip")
const dav1dPkgConfig = join(dav1dRoot, "lib", "pkgconfig")
const dav1dDll = join(dav1dRoot, "bin", "dav1d.dll")
if (process.platform === "win32" && (!existsSync(join(dav1dPkgConfig, "dav1d.pc")) || !existsSync(dav1dDll))) {
  await mkdir(dav1dRoot, { recursive: true })
  const extract = spawnSync("tar", ["-xf", dav1dArchive, "-C", dav1dRoot], { stdio: "inherit" })
  if (extract.status !== 0) process.exit(extract.status ?? 1)
}

const env = process.platform === "win32" ? {
  ...process.env,
  ...rustEnv,
  CARGO_PROFILE_RELEASE_LTO: process.env.CARGO_PROFILE_RELEASE_LTO ?? "thin",
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS: process.env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS ?? "8",
  PATH: `${join(dav1dRoot, "bin")};${process.env.PATH ?? ""}`,
  PKG_CONFIG: process.env.PKG_CONFIG ?? which("pkgconf") ?? which("pkg-config") ?? "pkgconf",
  PKG_CONFIG_PATH: [dav1dPkgConfig, process.env.PKG_CONFIG_PATH].filter(Boolean).join(";"),
  PKG_CONFIG_ALLOW_SYSTEM_CFLAGS: "1",
} : { ...process.env, ...rustEnv }

const processResult = spawnSync("cargo", args, {
  cwd: nativeRoot,
  env,
  stdio: "inherit",
})
if (processResult.status !== 0) process.exit(processResult.status ?? 1)

const libraryName = process.platform === "win32"
  ? "xiranite_czkawka_node.dll"
  : process.platform === "darwin"
    ? "libxiranite_czkawka_node.dylib"
    : "libxiranite_czkawka_node.so"
const source = join(nativeRoot, "target", profile, libraryName)
const destination = join(nativeRoot, "artifacts", `${process.platform}-${process.arch}`, `xiranite-czkawka.${process.platform}-${process.arch}.node`)
await mkdir(dirname(destination), { recursive: true })
await copyFile(source, destination)
if (process.platform === "win32") await copyFile(dav1dDll, join(dirname(destination), "dav1d.dll"))
console.log(`Czkawka native binding: ${destination}`)
