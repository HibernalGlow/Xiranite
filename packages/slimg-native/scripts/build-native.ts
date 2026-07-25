import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const nativeRoot = join(workspaceRoot, "native")
const profile = process.argv.includes("--debug") ? "debug" : "release"
const args = ["build", "-p", "xiranite-slimg-node"]
if (profile === "release") args.push("--release")
args.push("-j", "1")

const dav1dRoot = join(nativeRoot, "target", "dav1d")
const dav1dArchive = join(nativeRoot, "vendor", "dav1d-windows-x64.zip")
const dav1dPkgConfig = join(dav1dRoot, "lib", "pkgconfig")
const dav1dDll = join(dav1dRoot, "bin", "dav1d.dll")
if (process.platform === "win32" && (!existsSync(join(dav1dPkgConfig, "dav1d.pc")) || !existsSync(dav1dDll))) {
  await mkdir(dav1dRoot, { recursive: true })
  const extract = Bun.spawnSync(["tar", "-xf", dav1dArchive, "-C", dav1dRoot], { stdout: "inherit", stderr: "inherit" })
  if (!extract.success) process.exit(extract.exitCode)
}

const sccache = Bun.which("sccache")
const rustEnv = sccache && !process.env.RUSTC_WRAPPER ? { RUSTC_WRAPPER: sccache } : {}
const env = process.platform === "win32" ? {
  ...process.env,
  ...rustEnv,
  CARGO_PROFILE_RELEASE_LTO: process.env.CARGO_PROFILE_RELEASE_LTO ?? "thin",
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS: process.env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS ?? "8",
  PATH: `${join(dav1dRoot, "bin")};${process.env.PATH ?? ""}`,
  PKG_CONFIG: process.env.PKG_CONFIG ?? Bun.which("pkgconf") ?? Bun.which("pkg-config") ?? "pkgconf",
  PKG_CONFIG_PATH: [dav1dPkgConfig, process.env.PKG_CONFIG_PATH].filter(Boolean).join(";"),
  PKG_CONFIG_ALLOW_SYSTEM_CFLAGS: "1",
} : { ...process.env, ...rustEnv }

const cargo = Bun.spawn(["cargo", ...args], {
  cwd: nativeRoot,
  env,
  stdout: "inherit",
  stderr: "inherit",
})
const exitCode = await cargo.exited
if (exitCode !== 0) process.exit(exitCode)

const libraryName = process.platform === "win32"
  ? "xiranite_slimg_node.dll"
  : process.platform === "darwin"
    ? "libxiranite_slimg_node.dylib"
    : "libxiranite_slimg_node.so"
const source = join(nativeRoot, "target", profile, libraryName)
const destination = join(nativeRoot, "artifacts", `${process.platform}-${process.arch}`, `xiranite-slimg.${process.platform}-${process.arch}.node`)
await mkdir(dirname(destination), { recursive: true })
await Bun.write(destination, Bun.file(source))
if (process.platform === "win32") await Bun.write(join(dirname(destination), "dav1d.dll"), Bun.file(dav1dDll))
console.log(`slimg native binding: ${destination}`)
