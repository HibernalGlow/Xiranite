import { afterEach, describe, expect, test } from "vitest"
import { lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  updateNodeConfig,
  XIRANITE_CONFIG_FILENAME,
} from "./index.js"
import {
  loadNodeConfigWithHints,
  loadXiraniteConfig,
  resolveNodeConfig,
  saveXiraniteConfig,
  updateNodeConfigFile,
  updateXiraniteConfig,
} from "./node.js"

const RUN_ROOT = join(process.cwd(), "artifacts/test-runs/config", randomUUID())
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
})

describe("loadXiraniteConfig", () => {
  test("returns empty config when file missing (allowMissing=true default)", async () => {
    const result = await loadXiraniteConfig({ configPath: join(RUN_ROOT, "missing.toml") })
    expect(result.config).toEqual({})
  })

  test("throws when allowMissing=false and file missing", async () => {
    await expect(loadXiraniteConfig({ configPath: join(RUN_ROOT, "missing.toml"), allowMissing: false }))
      .rejects.toThrow(/not found/)
  })

  test("parses TOML and extracts nodes record", async () => {
    const dir = join(RUN_ROOT, "load-test")
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    await mkdir(dir, { recursive: true })
    await writeFile(path, [
      '[workspace]',
      'default = "ws1"',
      '',
      '[paths]',
      'data_dir = "/data"',
      '',
      '[app.ui]',
      'theme = "wuling"',
      '',
      '[webview2]',
      'features = ["JXLImageFormat", "CanvasOopRasterization"]',
      'switches = ["--enable-zero-copy"]',
      '',
      '[nodes.linku]',
      'enabled = true',
      '',
      '[[nodes.linku.links]]',
      'name = "example"',
      'source = "E:/Source"',
      'target = "D:/Links/example"',
    ].join("\n"), "utf8")

    const { config, path: loadedPath } = await loadXiraniteConfig({ configPath: path })
    expect(loadedPath).toBe(path)
    expect(config.workspace?.default).toBe("ws1")
    expect(config.paths?.data_dir).toBe("/data")
    expect(config.app?.ui).toEqual({ theme: "wuling" })
    expect(config.webview2).toEqual({
      features: ["JXLImageFormat", "CanvasOopRasterization"],
      switches: ["--enable-zero-copy"],
    })
    expect(config.nodes?.linku).toEqual({
      enabled: true,
      links: [{ name: "example", source: "E:/Source", target: "D:/Links/example" }],
    })
  })

  test("strips BOM from content", async () => {
    const dir = join(RUN_ROOT, "bom-test")
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    await mkdir(dir, { recursive: true })
    await writeFile(path, "\uFEFF[workspace]\ndefault = \"bom\"\n", "utf8")
    const { config } = await loadXiraniteConfig({ configPath: path })
    expect(config.workspace?.default).toBe("bom")
  })
})

describe("saveXiraniteConfig", () => {
  test("writes TOML and round-trips", async () => {
    const dir = join(RUN_ROOT, "save-test")
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    const original = {
      workspace: { default: "ws" },
      paths: { data_dir: "/data", database: "/db/x.db" },
      app: {
        ui: {
          theme: "wuling",
          colorMode: "dark",
        },
      },
      webview2: {
        features: ["JXLImageFormat", "msWebView2CodeCache"],
        switches: ["--enable-gpu-rasterization"],
      },
      nodes: {
        linku: { enabled: true, links: [{ name: "a", source: "s", target: "t" }] },
      },
    }
    const writtenPath = await saveXiraniteConfig(original, { configPath: path })
    expect(writtenPath).toBe(path)

    const { config } = await loadXiraniteConfig({ configPath: path })
    expect(config).toEqual(original)
  })

  test("writes a node's nested config through the shared writer and reads it back unchanged", async () => {
    const dir = join(RUN_ROOT, "save-nested-config")
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    const linku = { config: { schema_version: 1, links: [{ name: "a", source: "s", target: "t" }] } }
    await saveXiraniteConfig({ nodes: { other: { enabled: true }, linku } }, { configPath: path })

    const text = await readFile(path, "utf8")
    // The plain writer keeps each node's subtree nested instead of rewriting it into sibling sections.
    expect(text).toContain("[nodes.linku.config]")

    const { config } = await loadXiraniteConfig({ configPath: path })
    expect(config.nodes?.linku).toEqual(linku)
  })

  test("serializes concurrent patch transactions without losing unrelated nodes", async () => {
    const dir = join(RUN_ROOT, "concurrent-update-test")
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)

    await Promise.all(Array.from({ length: 16 }, (_, index) => updateXiraniteConfig(async (config) => {
      await new Promise((resolve) => setTimeout(resolve, index % 3))
      return updateNodeConfig(config, `writer-${index}`, { value: index })
    }, { configPath: path })))

    const { config } = await loadXiraniteConfig({ configPath: path })
    expect(config.nodes).toEqual(Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [`writer-${index}`, { value: index }]),
    ))
    expect((await readdir(dir)).filter((name) => name.includes(".xr-write.lock"))).toEqual([])
  })

  test("uses one lock for direct and symlinked paths to the same config", async () => {
    const dir = join(RUN_ROOT, "symlink-update-test")
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    const alias = join(dir, "config-alias.toml")
    await saveXiraniteConfig({ nodes: { seed: { value: true } } }, { configPath: path })
    await symlink(path, alias, "file")

    await Promise.all(Array.from({ length: 16 }, (_, index) => updateNodeConfigFile(
      `writer-${index}`,
      { value: index },
      { configPath: index % 2 === 0 ? path : alias },
    )))

    const { config } = await loadXiraniteConfig({ configPath: path })
    expect(config.nodes).toEqual({
      seed: { value: true },
      ...Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`writer-${index}`, { value: index }])),
    })
    expect((await lstat(alias)).isSymbolicLink()).toBe(true)
    expect((await readdir(dir)).filter((name) => name.includes(".xr-write.lock"))).toEqual([])
  })

  test("validates a transaction before replacing the existing file", async () => {
    const dir = join(RUN_ROOT, "failed-update-test")
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    const original = "[nodes.keep]\nenabled = true\n"
    await mkdir(dir, { recursive: true })
    await writeFile(path, original, "utf8")

    await expect(updateXiraniteConfig(() => ({ webview2: { features: "invalid", switches: [] } } as never), {
      configPath: path,
    })).rejects.toThrow()
    expect(await readFile(path, "utf8")).toBe(original)
  })
})

describe("resolveNodeConfig", () => {
  test("cli override takes precedence over xiranite config", async () => {
    const dir = join(RUN_ROOT, "resolve-test")
    cases.add(dir)
    const xiranitePath = join(dir, XIRANITE_CONFIG_FILENAME)
    const cliPath = join(dir, "cli-override.toml")
    await mkdir(dir, { recursive: true })
    await writeFile(xiranitePath, [
      '[nodes.linku]',
      'enabled = false',
    ].join("\n"), "utf8")
    await writeFile(cliPath, [
      '[linku]',
      'enabled = true',
    ].join("\n"), "utf8")

    const result = await resolveNodeConfig<{ enabled: boolean }>("linku", {
      cliConfigPath: cliPath,
      env: { XIRANITE_CONFIG_PATH: xiranitePath },
      extract: (value) => {
        const record = value as { enabled?: boolean } | undefined
        return record?.enabled !== undefined ? { enabled: record.enabled } : undefined
      },
    })

    expect(result.source).toBe("cli")
    expect(result.config?.enabled).toBe(true)
  })

  test("falls back to xiranite config when no cli override", async () => {
    const dir = join(RUN_ROOT, "fallback-test")
    cases.add(dir)
    const xiranitePath = join(dir, XIRANITE_CONFIG_FILENAME)
    await mkdir(dir, { recursive: true })
    await writeFile(xiranitePath, [
      '[nodes.linku]',
      'enabled = true',
      '[[nodes.linku.links]]',
      'name = "x"',
      'source = "s"',
      'target = "t"',
    ].join("\n"), "utf8")

    const result = await resolveNodeConfig<{ enabled: boolean }>("linku", {
      env: { XIRANITE_CONFIG_PATH: xiranitePath },
      extract: (value) => {
        const record = value as { enabled?: boolean } | undefined
        return record?.enabled !== undefined ? { enabled: record.enabled } : undefined
      },
    })

    expect(result.source).toBe("env")
    expect(result.config?.enabled).toBe(true)
  })

  test("returns default source when nothing found", async () => {
    const dir = join(RUN_ROOT, "default-test", randomUUID())
    cases.add(dir)
    const result = await resolveNodeConfig("linku", {
      env: { XIRANITE_DATA_DIR: dir },
    })
    expect(result.source).toBe("default")
    expect(result.config).toBeUndefined()
  })
})

describe("loadNodeConfigWithHints", () => {
  test("returns default source when config file missing", async () => {
    const dir = join(RUN_ROOT, "hints-missing", randomUUID())
    const result = await loadNodeConfigWithHints("cleanf", { configPath: join(dir, "missing.toml") })
    expect(result.source).toBe("default")
    expect(result.config).toBeUndefined()
    expect(result.fields).toEqual([])
  })

  test("returns empty fields when node section missing", async () => {
    const dir = join(RUN_ROOT, "hints-no-section", randomUUID())
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    await mkdir(dir, { recursive: true })
    await writeFile(path, '[nodes.linku]\nenabled = true\n', "utf8")

    const result = await loadNodeConfigWithHints("cleanf", { configPath: path })
    expect(result.source).toBe("xiranite-config")
    expect(result.config).toBeUndefined()
    expect(result.fields).toEqual([])
  })

  test("returns config and fields when node section exists", async () => {
    const dir = join(RUN_ROOT, "hints-found", randomUUID())
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    await mkdir(dir, { recursive: true })
    await writeFile(path, [
      '[nodes.cleanf]',
      'presets = ["empty_folders", "backup_files"]',
      'exclude = "temp"',
    ].join("\n"), "utf8")

    const result = await loadNodeConfigWithHints<{ presets: string[]; exclude: string }>("cleanf", { configPath: path })
    expect(result.source).toBe("xiranite-config")
    expect(result.config?.presets).toEqual(["empty_folders", "backup_files"])
    expect(result.config?.exclude).toBe("temp")
    expect(result.fields).toEqual(["presets", "exclude"])
  })

  test("emits hint to stderr when sink provided and node section exists", async () => {
    const dir = join(RUN_ROOT, "hints-emit", randomUUID())
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    await mkdir(dir, { recursive: true })
    await writeFile(path, '[nodes.cleanf]\npresets = ["empty_folders"]\n', "utf8")

    const chunks: string[] = []
    const result = await loadNodeConfigWithHints("cleanf", {
      configPath: path,
      hintSink: { stderr: { write: (c: string) => { chunks.push(c); return true } } },
    })
    expect(result.fields).toEqual(["presets"])
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain("[nodes.cleanf]")
    expect(chunks[0]).toContain("presets")
  })

  test("does not emit hint when silent", async () => {
    const dir = join(RUN_ROOT, "hints-silent", randomUUID())
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    await mkdir(dir, { recursive: true })
    await writeFile(path, '[nodes.cleanf]\npresets = ["empty_folders"]\n', "utf8")

    const chunks: string[] = []
    const result = await loadNodeConfigWithHints("cleanf", {
      configPath: path,
      silent: true,
      hintSink: { stderr: { write: (c: string) => { chunks.push(c); return true } } },
    })
    expect(result.config).toBeDefined()
    expect(chunks).toHaveLength(0)
  })

  test("does not emit hint in jsonMode", async () => {
    const dir = join(RUN_ROOT, "hints-json", randomUUID())
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    await mkdir(dir, { recursive: true })
    await writeFile(path, '[nodes.cleanf]\npresets = ["empty_folders"]\n', "utf8")

    const chunks: string[] = []
    await loadNodeConfigWithHints("cleanf", {
      configPath: path,
      jsonMode: true,
      hintSink: { stderr: { write: (c: string) => { chunks.push(c); return true } } },
    })
    expect(chunks).toHaveLength(0)
  })

  test("does not emit hint when node section missing", async () => {
    const dir = join(RUN_ROOT, "hints-no-section-emit", randomUUID())
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    await mkdir(dir, { recursive: true })
    await writeFile(path, '[nodes.linku]\nenabled = true\n', "utf8")

    const chunks: string[] = []
    await loadNodeConfigWithHints("cleanf", {
      configPath: path,
      hintSink: { stderr: { write: (c: string) => { chunks.push(c); return true } } },
    })
    expect(chunks).toHaveLength(0)
  })
})

describe("lockRetries is honored, not decorative", () => {
  /** A live foreign lock next to a seeded config document. */
  async function lockedFixture(label: string) {
    const dir = join(tmpdir(), `xiranite-retries-${label}-${randomUUID()}`)
    cases.add(dir)
    await mkdir(dir, { recursive: true })
    const path = join(dir, "xiranite.config.toml")
    await saveXiraniteConfig({ nodes: { seed: { value: true } } }, { dataDir: dir })
    const lock = `${path}.xr-write.lock`
    return { dir, path, lock }
  }

  test("lockRetries 0 refuses promptly while somebody else holds the lock", async () => {
    const { dir, path, lock } = await lockedFixture("zero")
    await writeFile(lock, "999999-1", "utf8")

    const started = Date.now()
    await expect(
      updateXiraniteConfig((config) => ({ ...config, nodes: { ...(config.nodes ?? {}), intruder: { x: 1 } } }), { dataDir: dir, lockRetries: 0 }),
    ).rejects.toThrow(/Timed out waiting for the Xiranite config writer/)
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(1_000)
    expect((await readFile(path, "utf8")).includes("intruder")).toBe(false)
  })

  test("the same lockRetries 0 writes fine once no lock exists", async () => {
    const { dir, path, lock } = await lockedFixture("released")
    await writeFile(lock, "999999-1", "utf8")
    await rm(lock, { force: true })

    await updateXiraniteConfig((config) => ({ ...config, nodes: { ...(config.nodes ?? {}), writer: { y: 2 } } }), { dataDir: dir, lockRetries: 0 })
    expect((await readFile(path, "utf8")).includes("writer")).toBe(true)
  })

  test("an out-of-range budget is refused before any waiting", async () => {
    const { dir } = await lockedFixture("range")
    await expect(
      updateXiraniteConfig((config) => config, { dataDir: dir, lockRetries: 101 }),
    ).rejects.toThrow(/lockRetries must be an integer between 0 and 100/)
  })
})
