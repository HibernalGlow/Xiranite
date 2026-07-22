import { afterEach, describe, expect, test } from "vitest"
import { lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"

const norm = (p: string): string => p.replace(/\\/g, "/")
import {
  getAppConfig,
  getWebview2Config,
  getNodeConfig,
  loadNodeConfigWithHints,
  loadXiraniteConfig,
  resolveNodeConfig,
  resolveXiraniteConfigPath,
  resolveLegacyXiraniteDataDirs,
  saveXiraniteConfig,
  stripBom,
  updateAppConfig,
  updateNodeConfigFile,
  updateXiraniteConfig,
  updateWebview2Config,
  updateNodeConfig,
  XIRANITE_CONFIG_FILENAME,
} from "./index.js"

const RUN_ROOT = join(process.cwd(), "artifacts/test-runs/config", randomUUID())
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
})

describe("resolveXiraniteConfigPath", () => {
  test("uses --configPath when provided", () => {
    const root = join(tmpdir(), "xiranite-config-test", randomUUID())
    const path = resolveXiraniteConfigPath({ configPath: "custom.toml", cwd: root })
    expect(norm(path)).toBe(`${norm(root)}/custom.toml`)
  })

  test("uses XIRANITE_CONFIG_PATH env when no --configPath", () => {
    const root = join(tmpdir(), "xiranite-env-test", randomUUID())
    const path = resolveXiraniteConfigPath({ env: { XIRANITE_CONFIG_PATH: root } })
    expect(norm(path)).toBe(norm(root))
  })

  test("uses XIRANITE_DATABASE_PATH directory when set", () => {
    const root = join(tmpdir(), "xiranite-db-test", randomUUID())
    const path = resolveXiraniteConfigPath({ env: { XIRANITE_DATABASE_PATH: join(root, "xiranite.db") } })
    expect(norm(path)).toBe(`${norm(root)}/${XIRANITE_CONFIG_FILENAME}`)
  })

  test("uses XIRANITE_DATA_DIR when set", () => {
    const root = join(tmpdir(), "xiranite-data-test", randomUUID())
    const path = resolveXiraniteConfigPath({ env: { XIRANITE_DATA_DIR: root } })
    expect(norm(path)).toBe(`${norm(root)}/${XIRANITE_CONFIG_FILENAME}`)
  })

  test("falls back to databasePath option when no env", () => {
    const root = join(tmpdir(), "xiranite-fb-test", randomUUID())
    const path = resolveXiraniteConfigPath({ databasePath: join(root, "xiranite.db") })
    expect(norm(path)).toBe(`${norm(root)}/${XIRANITE_CONFIG_FILENAME}`)
  })

  test("falls back to dataDir option when no env or database path", () => {
    const root = join(tmpdir(), "xiranite-data-option-test", randomUUID())
    const path = resolveXiraniteConfigPath({ dataDir: root })
    expect(norm(path)).toBe(`${norm(root)}/${XIRANITE_CONFIG_FILENAME}`)
  })

  test("falls back to the local data directory on Windows", () => {
    const root = join(tmpdir(), "xiranite-win-data-test", randomUUID())
    const localAppData = join(root, "Local")
    const path = resolveXiraniteConfigPath({
      env: {
        APPDATA: join(root, "Roaming"),
        LOCALAPPDATA: localAppData,
      },
      platform: "win32",
      homeDir: root,
    })
    expect(norm(path)).toBe(`${norm(localAppData)}/Xiranite/${XIRANITE_CONFIG_FILENAME}`)
  })

  test("reports the previous Roaming config directory as a legacy data directory", () => {
    const root = join(tmpdir(), "xiranite-win-legacy-test", randomUUID())
    const dirs = resolveLegacyXiraniteDataDirs({
      env: {
        APPDATA: join(root, "Roaming"),
        LOCALAPPDATA: join(root, "Local"),
      },
      platform: "win32",
      homeDir: root,
    })
    expect(dirs.map(norm)).toEqual([`${norm(root)}/Roaming/Xiranite`])
  })

  test("does not report legacy directories for explicit config paths", () => {
    const root = join(tmpdir(), "xiranite-explicit-legacy-test", randomUUID())
    const dirs = resolveLegacyXiraniteDataDirs({
      configPath: join(root, "custom.toml"),
      env: {
        APPDATA: join(root, "Roaming"),
        LOCALAPPDATA: join(root, "Local"),
      },
      platform: "win32",
      homeDir: root,
    })
    expect(dirs).toEqual([])
  })
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

  test("keeps NeoView first-level sections and inlines deeper objects through the shared writer", async () => {
    const dir = join(RUN_ROOT, "save-neoview-test")
    cases.add(dir)
    const path = join(dir, XIRANITE_CONFIG_FILENAME)
    await saveXiraniteConfig({ nodes: {
      other: { enabled: true },
      neoview: { config: {
        schema_version: 1,
        reader: { reading_direction: "right-to-left", subtitle: { font_size: 24, color: "#fff" } },
        bindings: { items: [{ action: "next", input: { key: "ArrowRight" } }] },
      } },
    } }, { configPath: path })

    const text = await readFile(path, "utf8")
    expect(text).toContain("[nodes.neoview]\nschema_version = 1")
    expect(text).toContain("[nodes.neoview.reader]")
    expect(text).toContain("[nodes.neoview.reader.subtitle]\nfont_size = 24\ncolor = \"#fff\"")
    expect(text).toContain("[nodes.neoview.bindings]")
    expect(text).toContain('items = [\n  { action = "next", input = { key = "ArrowRight" } },\n]')
    expect(text).not.toContain("nodes.neoview.config")
    expect(text).not.toContain("[nodes.neoview.bindings.items]")

    const { config } = await loadXiraniteConfig({ configPath: path })
    expect(config.nodes?.neoview).toMatchObject({
      schema_version: 1,
      reader: { reading_direction: "right-to-left", subtitle: { font_size: 24, color: "#fff" } },
    })
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

describe("getNodeConfig / updateNodeConfig", () => {
  test("getNodeConfig returns node section", () => {
    const config = { nodes: { linku: { enabled: true } } }
    expect(getNodeConfig(config, "linku")).toEqual({ enabled: true })
    expect(getNodeConfig(config, "missing")).toBeUndefined()
  })

  test("updateNodeConfig merges object node sections immutably", () => {
    const original = { nodes: { linku: { enabled: false, links: [{ source: "s", target: "t" }] } } }
    const updated = updateNodeConfig(original, "linku", { enabled: true })
    expect(updated.nodes?.linku).toEqual({ enabled: true, links: [{ source: "s", target: "t" }] })
    expect(original.nodes?.linku).toEqual({ enabled: false, links: [{ source: "s", target: "t" }] })
  })
})

describe("getAppConfig / updateAppConfig", () => {
  test("getAppConfig returns an app section", () => {
    const config = { app: { ui: { theme: "wuling" } } }
    expect(getAppConfig(config, "ui")).toEqual({ theme: "wuling" })
    expect(getAppConfig(config, "missing")).toBeUndefined()
  })

  test("updateAppConfig merges app sections immutably", () => {
    const original = { app: { ui: { theme: "spatial", colorMode: "light" } } }
    const updated = updateAppConfig(original, "ui", { colorMode: "dark" })
    expect(updated.app?.ui).toEqual({ theme: "spatial", colorMode: "dark" })
    expect(original.app?.ui).toEqual({ theme: "spatial", colorMode: "light" })
  })
})

describe("getWebview2Config / updateWebview2Config", () => {
  test("reads and replaces the top-level WebView2 startup config", () => {
    const original = {
      workspace: { default: "ws" },
      webview2: {
        features: ["JXLImageFormat"],
        switches: ["--enable-zero-copy"],
      },
    }
    expect(getWebview2Config(original)).toEqual(original.webview2)

    const updated = updateWebview2Config(original, {
      features: ["CanvasOopRasterization", "CanvasOopRasterization"],
      switches: ["--enable-gpu-rasterization"],
    })
    expect(updated.webview2).toEqual({
      features: ["CanvasOopRasterization"],
      switches: ["--enable-gpu-rasterization"],
    })
    expect(original.webview2.features).toEqual(["JXLImageFormat"])
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

describe("stripBom", () => {
  test("strips BOM prefix", () => {
    expect(stripBom("\uFEFFcontent")).toBe("content")
    expect(stripBom("content")).toBe("content")
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
