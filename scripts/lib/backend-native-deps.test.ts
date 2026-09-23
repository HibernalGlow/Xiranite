import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { findNativeBundleDependencies, stageNativeBundleDependencies } from "./backend-native-deps"

/**
 * The fixture is hoisted on purpose: every package is a real directory, so the
 * assertions cover the contract (start from the importer, ask the package that
 * declares the binding, keep only what declares an `os`) rather than one
 * installer's symlink arrangement. Bun's `isolated` sibling layout is the one CI
 * installs; it reaches the same directory through `libsql`'s own resolution root,
 * which is what the release gate then proves end to end.
 */
async function fixture(): Promise<{ root: string; importer: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "xiranite-backend-native-deps-"))
  const modules = path.join(root, "node_modules")
  await writePackage(path.join(modules, "@libsql/client"), { name: "@libsql/client", version: "0.15.15" })
  await writePackage(path.join(modules, "@libsql/core"), { name: "@libsql/core", version: "0.15.14" })
  await writePackage(
    path.join(modules, "@libsql/darwin-arm64"),
    { name: "@libsql/darwin-arm64", version: "0.5.29", main: "index.node", os: ["darwin"], cpu: ["arm64"] },
    { "index.node": "binding-bytes" },
  )
  await writePackage(path.join(modules, "libsql"), { name: "libsql", version: "0.5.29", main: "index.js" })
  const importer = path.join(root, "packages/repository/src/libsql.ts")
  await mkdir(path.dirname(importer), { recursive: true })
  await writeFile(importer, "export {}\n")
  return { root, importer }
}

async function writePackage(directory: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest))
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(directory, name), contents)
  }
}

describe("backend native bundle dependencies", () => {
  it("keeps only the packages that declare a target platform", async () => {
    const { importer } = await fixture()
    const found = await findNativeBundleDependencies(importer)
    expect(found.map((dependency) => [dependency.specifier, dependency.version])).toEqual([
      ["@libsql/darwin-arm64", "0.5.29"],
    ])
    // `Bun.resolveSync` reports the realpath, so assert the layout tail rather
    // than rebuilding the temporary directory's absolute prefix.
    expect(found[0]!.directory.endsWith(path.join("node_modules", "@libsql", "darwin-arm64"))).toBe(true)
  })

  it("stages the binding where the extracted bundle can resolve it", async () => {
    const { importer } = await fixture()
    const outputDirectory = path.join(path.dirname(importer), "..", "..", "build/wails")
    await mkdir(path.join(outputDirectory, "node_modules/@libsql/stale-platform"), { recursive: true })

    const staged = await stageNativeBundleDependencies({ importerFile: importer, outputDirectory })
    expect(staged.map((dependency) => dependency.specifier)).toEqual(["@libsql/darwin-arm64"])
    const binding = path.join(outputDirectory, "node_modules/@libsql/darwin-arm64/index.node")
    expect(await readFile(binding, "utf8")).toBe("binding-bytes")
    expect(await Bun.file(path.join(outputDirectory, "node_modules/@libsql/stale-platform")).exists()).toBe(false)
  })

  it("finds the binding through Bun's isolated layout, which is what CI installs", async () => {
    const { importer, root } = await isolatedFixture()
    const found = await findNativeBundleDependencies(importer)
    expect(found.map((dependency) => dependency.specifier)).toEqual(["@libsql/darwin-arm64"])
    // The binding must be reached as a sibling of `libsql` inside `.bun`, not as a
    // top-level package: the isolated tree deliberately hides undeclared ones.
    expect(found[0]!.directory).toContain(path.join(".bun", "libsql@0.5.29", "node_modules"))
    const staged = await stageNativeBundleDependencies({
      importerFile: importer,
      outputDirectory: path.join(root, "build/wails"),
    })
    expect(staged).toHaveLength(1)
    expect(
      await readFile(
        path.join(root, "build/wails/node_modules/@libsql/darwin-arm64/index.node"),
        "utf8",
      ),
    ).toBe("binding-bytes")
  })

  it("stages nothing when the installer placed no binding for this host", async () => {
    const { root, importer } = await fixture()
    await rm(path.join(root, "node_modules/@libsql/darwin-arm64"), { recursive: true, force: true })
    const outputDirectory = path.join(root, "build/wails")
    await expect(findNativeBundleDependencies(importer)).resolves.toEqual([])
    await expect(stageNativeBundleDependencies({ importerFile: importer, outputDirectory })).resolves.toEqual([])
  })
})

/**
 * Mirror of `bun install --linker=isolated`: each package's own dependencies are
 * linked beside it under `.bun/<name>@<version>/node_modules/`, and only the
 * declared workspace dependencies appear at the top level.
 */
async function isolatedFixture(): Promise<{ root: string; importer: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "xiranite-backend-native-deps-isolated-"))
  const bunStore = path.join(root, "node_modules/.bun")
  const clientDirectory = path.join(bunStore, "@libsql+client@0.15.15/node_modules/@libsql/client")
  const libsqlDirectory = path.join(bunStore, "libsql@0.5.29/node_modules/libsql")
  await writePackage(clientDirectory, { name: "@libsql/client", version: "0.15.15" })
  await writePackage(libsqlDirectory, { name: "libsql", version: "0.5.29", main: "index.js" })
  await writePackage(
    path.join(bunStore, "libsql@0.5.29/node_modules/@libsql/darwin-arm64"),
    { name: "@libsql/darwin-arm64", version: "0.5.29", main: "index.node", os: ["darwin"], cpu: ["arm64"] },
    { "index.node": "binding-bytes" },
  )
  await symlink(libsqlDirectory, path.join(bunStore, "@libsql+client@0.15.15/node_modules/libsql"))
  await mkdir(path.join(root, "node_modules/@libsql"), { recursive: true })
  await symlink(clientDirectory, path.join(root, "node_modules/@libsql/client"))
  const importer = path.join(root, "packages/backend/src/index.ts")
  await mkdir(path.dirname(importer), { recursive: true })
  await writeFile(importer, "export {}\n")
  return { root, importer }
}
