import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

/**
 * The boundary this package is built on, kept enforceable.
 *
 * `@xiranite/config` is split so the root entry is pure (schema, paths, TOML) and every byte-touching
 * operation lives behind `@xiranite/config/node`. That split is not cosmetic: a bundle that reaches an npm
 * lock implementation dies *at load* inside the QuickJS realm, because `graceful-fs` assigns properties onto
 * an `fs` object whose properties are not writable (measured on `linku`,
 * `docs/migration/quickjs-substrate-evaluation.md` §15.8). Nothing in the repo would notice a re-addition —
 * `audit:node-bundles` only reports what the current graph happens to contain — so the rule needs a test that
 * fails on the source change itself.
 */
const ROOT_MODULES = ["index.ts", "paths.ts", "schema.ts", "xiraniteToml.ts", "transport.ts"] as const
const IO_MODULE = "node.ts"

/** Every `from "…"` specifier in a source file, including the ones written across several lines. */
function specifiersOf(file: string): string[] {
  const source = readFileSync(join(srcDir, file), "utf8")
  return [...source.matchAll(/from\s*"([^"]+)"/g)].map((match) => match[1])
}

const srcDir = dirname(fileURLToPath(import.meta.url))

function file(name: string): string {
  return join(srcDir, name)
}

describe("config package boundary", () => {
  test("the pure side reaches no filesystem, process or lock implementation", () => {
    for (const module of ROOT_MODULES) {
      const specifiers = specifiersOf(module)
      // Positive control first: these files do import things, so an empty list would mean a blind scan.
      expect(specifiers.length, `${module} should have imports to inspect`).toBeGreaterThan(0)
      const offenders = specifiers.filter(
        (specifier) =>
          specifier.startsWith("node:fs")
          || specifier.startsWith("node:child_process")
          || specifier.startsWith("node:worker_threads")
          || specifier === "proper-lockfile"
          || specifier === "write-file-atomic"
          || specifier.startsWith("graceful-fs")
          || specifier.startsWith("signal-exit"),
      )
      expect(offenders, `${module} must stay free of filesystem and lock imports`).toEqual([])
    }
  })

  test("the IO module is the only place that touches node:fs", () => {
    const ioSpecifiers = specifiersOf(IO_MODULE)
    expect(ioSpecifiers.some((specifier) => specifier.startsWith("node:fs"))).toBe(true)
  })

  test("no lock or atomic-write npm implementation comes back into this package", () => {
    const manifest = JSON.parse(readFileSync(file("../package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const declared = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]
    expect(declared.filter((name) => ["proper-lockfile", "write-file-atomic", "graceful-fs", "signal-exit"].includes(name))).toEqual([])
    // Control: the dependency list is real, so the assertion above is not passing on an empty scan.
    expect(declared).toContain("zod")
  })

  test("the realm transport and the Node transport are separate entrypoints", () => {
    const exports = JSON.parse(readFileSync(file("../package.json"), "utf8")).exports as Record<string, unknown>
    expect(Object.keys(exports)).toEqual([".", "./node"])
  })

  test("the pure entry re-exports only from the pure modules", () => {
    expect(specifiersOf("index.ts").filter((specifier) => specifier.startsWith("./"))).toEqual([
      "./paths.js",
      "./schema.js",
      "./xiraniteToml.js",
      "./transport.js",
    ])
  })
})
