import { describe, expect, it } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { findNativeBundleDependencies, stageNativeBundleDependencies } from "./backend-native-deps"

async function writePackage(directory: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest))
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(directory, name), contents)
  }
}

async function importerFile(root: string): Promise<string> {
  const file = path.join(root, "packages/repository/src/libsql.ts")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, "export {}\n")
  return file
}

const bindingManifest = {
  name: "@libsql/darwin-arm64",
  version: "0.5.29",
  main: "index.node",
  os: ["darwin"],
  cpu: ["arm64"],
}

/** A hoisted install: every package is a real directory under one `node_modules`. */
async function hoistedFixture(): Promise<{ root: string; importer: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "xiranite-native-deps-hoisted-"))
  const modules = path.join(root, "node_modules")
  await writePackage(path.join(modules, "@libsql/client"), { name: "@libsql/client", version: "0.15.15" })
  await writePackage(path.join(modules, "@libsql/core"), { name: "@libsql/core", version: "0.15.14" })
  await writePackage(path.join(modules, "@libsql/darwin-arm64"), bindingManifest, { "index.node": "binding-bytes" })
  await writePackage(path.join(modules, "libsql"), { name: "libsql", version: "0.5.29", main: "index.js" })
  return { root, importer: await importerFile(root) }
}

/**
 * Mirror of `bun install --linker=isolated`, which is what the release job runs:
 * each package exists once under `.bun/<name>@<version>/node_modules/<name>` and is
 * reached through symlinks, including a dependency's own optional binding. Those
 * links are why the staged copy must be dereferenced: a copied symlink points into
 * the build machine's store, and `go:embed` silently skips it.
 */
async function isolatedFixture(): Promise<{ root: string; importer: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "xiranite-native-deps-isolated-"))
  const store = path.join(root, "node_modules/.bun")
  const clientReal = path.join(store, "@libsql+client@0.15.15/node_modules/@libsql/client")
  const libsqlReal = path.join(store, "libsql@0.5.29/node_modules/libsql")
  const bindingReal = path.join(store, "@libsql+darwin-arm64@0.5.29/node_modules/@libsql/darwin-arm64")
  await writePackage(clientReal, { name: "@libsql/client", version: "0.15.15" })
  await writePackage(libsqlReal, { name: "libsql", version: "0.5.29", main: "index.js" }, { "index.js": "module.exports = {}" })
  await writePackage(bindingReal, bindingManifest, { "index.node": "binding-bytes" })
  // A package may reach outside its own directory; a copied link would then point
  // at the build machine's store, which is exactly what must not be embedded.
  await symlink(path.join(libsqlReal, "index.js"), path.join(bindingReal, "sidecar.node"))
  await symlink(libsqlReal, path.join(store, "@libsql+client@0.15.15/node_modules/libsql"))
  await mkdir(path.join(store, "libsql@0.5.29/node_modules/@libsql"), { recursive: true })
  await symlink(bindingReal, path.join(store, "libsql@0.5.29/node_modules/@libsql/darwin-arm64"))
  await mkdir(path.join(root, "node_modules/@libsql"), { recursive: true })
  await symlink(clientReal, path.join(root, "node_modules/@libsql/client"))
  return { root, importer: await importerFile(root) }
}

describe("backend native bundle dependencies", () => {
  it("keeps only the packages that declare a target platform", async () => {
    const { importer } = await hoistedFixture()
    const found = await findNativeBundleDependencies(importer)
    expect(found.map((dependency) => [dependency.specifier, dependency.version])).toEqual([
      ["@libsql/darwin-arm64", "0.5.29"],
    ])
  })

  it("stages the binding where the extracted bundle can resolve it", async () => {
    const { root, importer } = await hoistedFixture()
    const outputDirectory = path.join(root, "build/wails")
    await mkdir(path.join(outputDirectory, "node_modules/@libsql/stale-platform"), { recursive: true })

    const staged = await stageNativeBundleDependencies({ importerFile: importer, outputDirectory })
    expect(staged.map((dependency) => dependency.specifier)).toEqual(["@libsql/darwin-arm64"])
    const binding = path.join(outputDirectory, "node_modules/@libsql/darwin-arm64/index.node")
    expect(await readFile(binding, "utf8")).toBe("binding-bytes")
    expect(await Bun.file(path.join(outputDirectory, "node_modules/@libsql/stale-platform")).exists()).toBe(false)
  })

  it("copies real files out of the isolated layout's symlinks", async () => {
    const { root, importer } = await isolatedFixture()
    const outputDirectory = path.join(root, "build/wails")

    const staged = await stageNativeBundleDependencies({ importerFile: importer, outputDirectory })
    expect(staged.map((dependency) => dependency.specifier)).toEqual(["@libsql/darwin-arm64"])
    // Discovery reports the store path the binding really lives at, not the link.
    expect(staged[0]!.directory).toContain(path.join(".bun", "@libsql+darwin-arm64@0.5.29"))

    const destination = path.join(outputDirectory, "node_modules/@libsql/darwin-arm64")
    // Nothing in the embedded tree may be a link: `go:embed` skips links, and a link
    // that survived would address the build machine's store instead of the release.
    const stagedDirectory = await lstat(destination)
    expect(stagedDirectory.isDirectory() && !stagedDirectory.isSymbolicLink()).toBe(true)
    for (const name of ["index.node", "package.json", "sidecar.node"]) {
      const info = await lstat(path.join(destination, name))
      expect(info.isFile() && !info.isSymbolicLink(), `${name} must be a regular file`).toBe(true)
    }
    expect(await readFile(path.join(destination, "index.node"), "utf8")).toBe("binding-bytes")
  })

  it("refuses to stage a bundle that would ship without its binding", async () => {
    const { root, importer } = await hoistedFixture()
    await rm(path.join(root, "node_modules/@libsql/darwin-arm64"), { recursive: true, force: true })
    expect(await findNativeBundleDependencies(importer)).toEqual([])
    await expect(
      stageNativeBundleDependencies({ importerFile: importer, outputDirectory: path.join(root, "build/wails") }),
    ).rejects.toThrow(/no @libsql native binding is installed/)
  })
})
