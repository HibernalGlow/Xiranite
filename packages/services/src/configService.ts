import { access, copyFile, cp, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import {
  getAppConfig,
  getWebview2Config,
  getNodeConfig,
  loadXiraniteConfig,
  parseToml,
  pathExists,
  resolveLegacyXiraniteDataDirs,
  resolveXiraniteConfigPath,
  saveXiraniteConfig,
  stripBom,
  updateAppConfig,
  updateWebview2Config,
  updateNodeConfig,
  XIRANITE_CONFIG_FILENAME,
  type XiraniteConfig,
  type Webview2Config,
  type ResolveConfigPathOptions,
} from "@xiranite/config"
import type { NodeRunHistoryService } from "./historyService.js"

export interface GetNodeConfigResult {
  config: unknown | undefined
  path: string
}

export interface UpdateNodeConfigResult {
  config: unknown
  path: string
}

export interface GetAppConfigResult {
  config: unknown | undefined
  path: string
}

export interface UpdateAppConfigResult {
  config: unknown
  path: string
}

export interface Webview2ConfigResult {
  config: Webview2Config | undefined
  path: string
}

export interface GetConfigResult {
  config: XiraniteConfig
  path: string
}

export interface ImportLegacyResult {
  imported: boolean
  config: unknown
  path: string
}

export interface OpenConfigFileResult {
  opened: boolean
  path: string
}

export interface EnsureConfigFileResult {
  path: string
  created: boolean
}

export interface CustomThemesResult {
  themes: SerializableTheme[]
  path: string
}

export interface BackgroundImageResult {
  url: string | null
  path: string
}

export interface NodePreset {
  id: string
  name: string
  values: Record<string, unknown>
}

export interface NodePresetsResult {
  presets: NodePreset[]
}

export interface NodePresetResult {
  preset: NodePreset
}

export interface SerializableTheme {
  name: string
  cssVars?: Record<string, unknown>
  [key: string]: unknown
}

function isSerializableTheme(value: unknown): value is SerializableTheme {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { name?: unknown }).name === "string"
}

export type OpenPathHandler = (path: string) => Promise<void> | void

const CONFIG_TEMPLATE = `# Xiranite 配置文件
# 文档: docs/node-config-toml-strategy.md
# 路径解析优先级:
#   --config <path>
#   XIRANITE_CONFIG_PATH
#   XIRANITE_DATABASE_PATH 同目录 / xiranite.config.toml
#   XIRANITE_DATA_DIR / xiranite.config.toml
#   系统标准目录 / Xiranite / xiranite.config.toml

[workspace]
default = "ws-default"

[paths]
# data_dir = ""
# database = "./xiranite.db"

# WebView2 启动参数（修改后需完全重启桌面应用）
[webview2]
features = ["JXLImageFormat", "msWebView2CodeCache", "msWebView2NativeEventDispatch", "CanvasOopRasterization"]
switches = ["--enable-gpu-rasterization", "--enable-zero-copy"]

# 节点配置示例 (详见 docs/node-config-toml-strategy.md):
#
# [nodes.linku]
# enabled = true
#
# [[nodes.linku.links]]
# name = "example"
# source = "E:/Source"
# target = "D:/Links/example"
#
# [nodes.owithu]
# enabled = true
#
# [[nodes.owithu.entries]]
# name = "Open with Xiranite"
# command = "xiranite"
# extensions = [".zip", ".rar", ".7z"]
#
# [nodes.enginev]
# workshop_root = "E:/SteamLibrary/steamapps/workshop/content/431960"
`

export class ConfigService {
  private readonly configPath: string | undefined
  private readonly databasePath: string | undefined
  private readonly dataDir: string | undefined
  private readonly env: NodeJS.ProcessEnv | undefined
  private readonly platform: NodeJS.Platform | undefined
  private readonly homeDir: string | undefined
  private readonly openPath: OpenPathHandler
  private readonly history?: NodeRunHistoryService
  private readonly kvRepository?: { getKvValue: (key: string) => Promise<string | null>; setKvValue: (key: string, value: string) => Promise<void>; deleteKvValue: (key: string) => Promise<void> }

  constructor(options: {
    configPath?: string
    databasePath?: string
    dataDir?: string
    env?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    homeDir?: string
    openPath?: OpenPathHandler
    history?: NodeRunHistoryService
    kvRepository?: { getKvValue: (key: string) => Promise<string | null>; setKvValue: (key: string, value: string) => Promise<void>; deleteKvValue: (key: string) => Promise<void> }
  } = {}) {
    this.configPath = options.configPath
    this.databasePath = options.databasePath
    this.dataDir = options.dataDir
    this.env = options.env
    this.platform = options.platform
    this.homeDir = options.homeDir
    this.openPath = options.openPath ?? openPathWithSystemDefaultApp
    this.history = options.history
    this.kvRepository = options.kvRepository
  }

  async getConfig(): Promise<GetConfigResult> {
    const { config, path } = await loadXiraniteConfig(this.resolveOptions())
    return { config, path }
  }

  async getNodeConfig(nodeId: string): Promise<GetNodeConfigResult> {
    const { config, path } = await loadXiraniteConfig(this.resolveOptions())
    return { config: getNodeConfig(config, nodeId), path }
  }

  async updateNodeConfig(nodeId: string, patch: unknown): Promise<UpdateNodeConfigResult> {
    const startedAt = Date.now()
    const { config, path } = await loadXiraniteConfig(this.resolveOptions())
    const updated = updateNodeConfig(config, nodeId, patch)
    await saveXiraniteConfig(updated, this.resolveOptions())
    const nextNodeConfig = getNodeConfig(updated, nodeId)
    void this.history?.record({
      kind: "config",
      operation: "config.node.update",
      title: nodeId,
      message: `Updated node config: ${nodeId}`,
      target: { type: "node-config", id: nodeId, label: nodeId },
      nodeId,
      input: patch,
      result: { path },
      resultSummary: path,
      startedAt,
      finishedAt: Date.now(),
    })
    return { config: nextNodeConfig, path }
  }

  /**
   * Node presets are application data, rather than a node's file-based default
   * config. Store them in libSQL so CRUD is atomic with the active backend and
   * available to every client connected to that database.
   */
  async getNodePresets(nodeId: string): Promise<NodePresetsResult> {
    const { config } = await loadXiraniteConfig(this.resolveOptions())
    const nodeConfig = getNodeConfig(config, nodeId)
    const tomlPresets = isRecord(nodeConfig)
      ? parseNodePresetValue(nodeConfig.presets ?? nodeConfig.customPresets)
      : undefined
    const serialized = await this.kvRepository?.getKvValue(nodePresetKey(nodeId)) ?? null
    const databasePresets = parseNodePresets(serialized)

    if (tomlPresets !== undefined) {
      if (this.kvRepository && JSON.stringify(tomlPresets) !== JSON.stringify(databasePresets)) {
        await this.kvRepository.setKvValue(nodePresetKey(nodeId), JSON.stringify(tomlPresets))
      }
      return { presets: tomlPresets }
    }

    if (databasePresets.length) await this.saveNodePresetsToToml(nodeId, databasePresets)
    return { presets: databasePresets }
  }

  async createNodePreset(nodeId: string, input: { name: string; values: unknown }): Promise<NodePresetResult> {
    const presets = await this.getNodePresets(nodeId)
    const preset: NodePreset = {
      id: `custom-${crypto.randomUUID()}`,
      name: normalizePresetName(input.name),
      values: normalizePresetValues(input.values),
    }
    await this.saveNodePresets(nodeId, [...presets.presets, preset])
    return { preset }
  }

  async updateNodePreset(nodeId: string, presetId: string, input: { name?: string; values?: unknown }): Promise<NodePresetResult> {
    const { presets } = await this.getNodePresets(nodeId)
    const index = presets.findIndex((preset) => preset.id === presetId)
    if (index < 0) throw new Error(`Node preset not found: ${presetId}`)

    const current = presets[index]!
    const preset: NodePreset = {
      ...current,
      ...(input.name === undefined ? {} : { name: normalizePresetName(input.name) }),
      ...(input.values === undefined ? {} : { values: normalizePresetValues(input.values) }),
    }
    const next = presets.slice()
    next[index] = preset
    await this.saveNodePresets(nodeId, next)
    return { preset }
  }

  async deleteNodePreset(nodeId: string, presetId: string): Promise<{ deleted: boolean }> {
    const { presets } = await this.getNodePresets(nodeId)
    const next = presets.filter((preset) => preset.id !== presetId)
    if (next.length === presets.length) return { deleted: false }
    await this.saveNodePresets(nodeId, next)
    return { deleted: true }
  }

  async getAppConfig(section: string): Promise<GetAppConfigResult> {
    const { config, path } = await loadXiraniteConfig(this.resolveOptions())
    return { config: getAppConfig(config, section), path }
  }

  async updateAppConfig(section: string, patch: unknown): Promise<UpdateAppConfigResult> {
    const startedAt = Date.now()
    const { config, path } = await loadXiraniteConfig(this.resolveOptions())
    const updated = updateAppConfig(config, section, patch)
    await saveXiraniteConfig(updated, this.resolveOptions())
    const nextAppConfig = getAppConfig(updated, section)
    void this.history?.record({
      kind: "config",
      operation: "config.app.update",
      title: section,
      message: `Updated app config: ${section}`,
      target: { type: "app-config", id: section, label: section },
      input: patch,
      result: { path },
      resultSummary: path,
      startedAt,
      finishedAt: Date.now(),
    })
    return { config: nextAppConfig, path }
  }

  async getWebview2Config(): Promise<Webview2ConfigResult> {
    const { config, path } = await loadXiraniteConfig(this.resolveOptions())
    return { config: getWebview2Config(config), path }
  }

  async updateWebview2Config(nextConfig: Webview2Config): Promise<Webview2ConfigResult> {
    const startedAt = Date.now()
    const { config, path } = await loadXiraniteConfig(this.resolveOptions())
    const updated = updateWebview2Config(config, nextConfig)
    await saveXiraniteConfig(updated, this.resolveOptions())
    void this.history?.record({
      kind: "config",
      operation: "config.webview2.update",
      title: "WebView2 experiments",
      message: "Updated WebView2 startup configuration.",
      target: { type: "config-file", id: path, label: path },
      input: nextConfig,
      result: { path },
      resultSummary: path,
      startedAt,
      finishedAt: Date.now(),
    })
    return { config: getWebview2Config(updated), path }
  }

  getConfigPath(): string {
    return resolveXiraniteConfigPath(this.resolveOptions())
  }

  async ensureConfigFile(): Promise<EnsureConfigFileResult> {
    const startedAt = Date.now()
    const path = this.getConfigPath()
    await this.migrateLegacyData(path)
    try {
      await access(path)
      return { path, created: false }
    } catch {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, CONFIG_TEMPLATE, "utf8")
      void this.history?.record({
        kind: "config",
        operation: "config.file.create",
        title: "Config file",
        message: "Created config file.",
        target: { type: "config-file", id: path, label: path },
        result: { path },
        resultSummary: path,
        startedAt,
        finishedAt: Date.now(),
      })
      return { path, created: true }
    }
  }

  async openConfigFile(): Promise<OpenConfigFileResult> {
    const startedAt = Date.now()
    const { config, path } = await loadXiraniteConfig(this.resolveOptions())
    await saveXiraniteConfig(config, this.resolveOptions())
    await this.openPath(path)
    void this.history?.record({
      kind: "config",
      operation: "config.file.open",
      title: "Config file",
      message: "Opened config file.",
      target: { type: "config-file", id: path, label: path },
      result: { path },
      resultSummary: path,
      startedAt,
      finishedAt: Date.now(),
    })
    return { opened: true, path }
  }

  /**
   * 读取 customThemes（独立 JSON 文件，不再写入 TOML）。
   * 首次调用时若 TOML 中残留旧 customThemes，自动迁移到 themes.json 并清理 TOML。
   */
  async getCustomThemes(): Promise<CustomThemesResult> {
    const themesPath = this.resolveThemesPath()
    try {
      const content = await readFile(themesPath, "utf8")
      const parsed = JSON.parse(stripBom(content)) as unknown
      const themes = Array.isArray(parsed) ? parsed.filter(isSerializableTheme) : []
      return { themes, path: themesPath }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { themes: [], path: themesPath }
      }
      throw error
    }
  }

  /**
   * 保存 customThemes 到独立 JSON 文件，并清理 TOML 中的残留 customThemes。
   */
  async saveCustomThemes(themes: unknown[]): Promise<CustomThemesResult> {
    const startedAt = Date.now()
    const themesPath = this.resolveThemesPath()
    const safe = themes.filter(isSerializableTheme)
    await mkdir(dirname(themesPath), { recursive: true })
    await writeFile(themesPath, JSON.stringify(safe, null, 2), "utf8")
    void this.history?.record({
      kind: "config",
      operation: "config.themes.save",
      title: "Custom themes",
      message: `Saved ${safe.length} custom theme(s)`,
      target: { type: "config-file", id: themesPath, label: themesPath },
      input: { count: safe.length },
      result: { path: themesPath, count: safe.length },
      resultSummary: themesPath,
      startedAt,
      finishedAt: Date.now(),
    })
    return { themes: safe, path: themesPath }
  }

  /**
   * 读取背景图片 data URL（存储在数据库 KV 中，不写入 TOML）。
   */
  async getBackgroundImage(): Promise<BackgroundImageResult> {
    const path = this.getConfigPath()
    if (!this.kvRepository) return { url: null, path }
    const url = await this.kvRepository.getKvValue("bgImageUrl")
    return { url, path }
  }

  /**
   * 保存背景图片 data URL 到数据库 KV。
   */
  async saveBackgroundImage(url: string | null): Promise<BackgroundImageResult> {
    const startedAt = Date.now()
    const path = this.getConfigPath()
    if (!this.kvRepository) return { url: null, path }
    if (url) {
      await this.kvRepository.setKvValue("bgImageUrl", url)
    } else {
      await this.kvRepository.deleteKvValue("bgImageUrl")
    }
    void this.history?.record({
      kind: "config",
      operation: "config.bg-image.save",
      title: "Background image",
      message: url ? "Saved background image" : "Cleared background image",
      target: { type: "config-file", id: path, label: path },
      input: { hasImage: !!url },
      result: { path },
      resultSummary: path,
      startedAt,
      finishedAt: Date.now(),
    })
    return { url, path }
  }

  private async saveNodePresets(nodeId: string, presets: NodePreset[]): Promise<void> {
    await this.saveNodePresetsToToml(nodeId, presets)
    if (this.kvRepository) await this.kvRepository.setKvValue(nodePresetKey(nodeId), JSON.stringify(presets))
  }

  private async saveNodePresetsToToml(nodeId: string, presets: NodePreset[]): Promise<void> {
    const { config } = await loadXiraniteConfig(this.resolveOptions())
    const updated = updateNodeConfig(config, nodeId, { presets })
    await saveXiraniteConfig(updated, this.resolveOptions())
  }

  private resolveThemesPath(): string {
    const configPath = resolveXiraniteConfigPath(this.resolveOptions())
    return join(dirname(configPath), "themes.json")
  }

  /*
  // 以下是已注释掉的旧版迁移方法（不再使用）
  // 从 TOML 的 app.ui.workspace.customThemes 提取旧主题，迁移到 themes.json，并从 TOML 清除。
  private async extractLegacyCustomThemes(): Promise<{ themes: SerializableTheme[]; migrated: boolean }> {
    const { config, path } = await loadXiraniteConfig(this.resolveOptions())
    const appUi = config.app?.["ui"] as Record<string, unknown> | undefined
    const workspace = appUi?.["workspace"] as Record<string, unknown> | undefined
    const legacyThemes = Array.isArray(workspace?.customThemes) ? workspace!.customThemes.filter(isSerializableTheme) : []
    if (legacyThemes.length === 0) return { themes: [], migrated: false }

    const themesPath = this.resolveThemesPath()
    await mkdir(dirname(themesPath), { recursive: true })
    await writeFile(themesPath, JSON.stringify(legacyThemes, null, 2), "utf8")
    await this.stripLegacyCustomThemes(config, path)
    return { themes: legacyThemes, migrated: true }
  }

  // 从 TOML 中移除 app.ui.workspace.customThemes 字段（不触碰其他配置）。
  private async stripLegacyCustomThemes(existing?: XiraniteConfig, existingPath?: string): Promise<void> {
    const { config, path } = existing && existingPath
      ? { config: existing, path: existingPath }
      : await loadXiraniteConfig(this.resolveOptions())
    const app = config.app as Record<string, unknown> | undefined
    const ui = app?.["ui"] as Record<string, unknown> | undefined
    const workspace = ui?.["workspace"] as Record<string, unknown> | undefined
    if (!workspace || !Array.isArray(workspace.customThemes)) return
    delete workspace.customThemes
    await saveXiraniteConfig(config, this.resolveOptions())
  }
  */

  async importLegacy(legacyPath: string, nodeId: string): Promise<ImportLegacyResult> {
    const startedAt = Date.now()
    const { readFile } = await import("node:fs/promises")

    let content: string
    try {
      content = await readFile(legacyPath, "utf8")
    } catch {
      void this.history?.record({
        kind: "config",
        operation: "config.legacy.import",
        status: "error",
        title: nodeId,
        message: `Legacy config import failed: ${legacyPath}`,
        target: { type: "node-config", id: nodeId, label: nodeId },
        nodeId,
        input: { legacyPath, nodeId },
        startedAt,
        finishedAt: Date.now(),
      })
      return { imported: false, config: undefined, path: legacyPath }
    }

    const parsed = parseLegacyConfig(content, legacyPath)
    const nodeValue = (parsed.nodes as Record<string, unknown> | undefined)?.[nodeId] ?? parsed[nodeId] ?? parsed

    const { config, path } = await loadXiraniteConfig(this.resolveOptions())
    const updated = updateNodeConfig(config, nodeId, nodeValue)
    await saveXiraniteConfig(updated, this.resolveOptions())

    void this.history?.record({
      kind: "config",
      operation: "config.legacy.import",
      title: nodeId,
      message: `Imported legacy config: ${nodeId}`,
      target: { type: "node-config", id: nodeId, label: nodeId },
      nodeId,
      input: { legacyPath, nodeId },
      result: { path, config: nodeValue },
      resultSummary: path,
      startedAt,
      finishedAt: Date.now(),
    })
    return { imported: true, config: nodeValue, path }
  }

  private async migrateLegacyData(targetConfigPath: string): Promise<void> {
    const targetDataDir = dirname(targetConfigPath)
    const legacyDataDirs = resolveLegacyXiraniteDataDirs(this.resolveOptions())
    for (const legacyDataDir of legacyDataDirs) {
      const info = await stat(legacyDataDir).catch(() => null)
      if (!info?.isDirectory()) continue

      await migrateLegacyConfigFile(join(legacyDataDir, XIRANITE_CONFIG_FILENAME), targetConfigPath, targetDataDir)
      await migrateLegacyArtifactsDir(join(legacyDataDir, "artifacts"), join(targetDataDir, "artifacts"), targetDataDir)
      await removeDirectoryIfEmpty(legacyDataDir)
    }
  }

  private resolveOptions(): ResolveConfigPathOptions {
    return {
      configPath: this.configPath,
      databasePath: this.databasePath,
      dataDir: this.dataDir,
      env: this.env,
      platform: this.platform,
      homeDir: this.homeDir,
    }
  }
}

function nodePresetKey(nodeId: string): string {
  return `config.node-presets.v1:${nodeId}`
}

function parseNodePresets(serialized: string | null): NodePreset[] {
  if (!serialized) return []
  try {
    const parsed = JSON.parse(serialized) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((candidate) => {
      if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id.startsWith("custom-") || typeof candidate.name !== "string" || !isRecord(candidate.values)) return []
      try {
        return [{ id: candidate.id, name: normalizePresetName(candidate.name), values: candidate.values }]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

function parseNodePresetValue(value: unknown): NodePreset[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id.startsWith("custom-") || typeof candidate.name !== "string" || !isRecord(candidate.values)) return []
    try {
      return [{ id: candidate.id, name: normalizePresetName(candidate.name), values: candidate.values }]
    } catch {
      return []
    }
  })
}

function normalizePresetName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Preset name must be a string.")
  const name = value.trim()
  if (!name) throw new Error("Preset name is required.")
  if (name.length > 120) throw new Error("Preset name must be 120 characters or fewer.")
  return name
}

function normalizePresetValues(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Preset values must be an object.")
  return value
}

function parseLegacyConfig(content: string, legacyPath: string): Record<string, unknown> {
  const stripped = stripBom(content)
  const ext = extname(legacyPath).toLowerCase()
  const trimmed = stripped.trimStart()

  if (ext === ".json" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(stripped) as unknown
    if (isRecord(parsed)) return parsed
    return { value: parsed }
  }

  return parseToml(stripped) as Record<string, unknown>
}

async function migrateLegacyConfigFile(legacyConfigPath: string, targetConfigPath: string, targetDataDir: string): Promise<void> {
  const legacyInfo = await stat(legacyConfigPath).catch(() => null)
  if (!legacyInfo?.isFile()) return

  if (!await pathExists(targetConfigPath)) {
    await movePath(legacyConfigPath, targetConfigPath)
    return
  }

  const backupPath = await uniquePath(join(targetDataDir, "migration-backups", "xiranite.config.legacy.toml"))
  try {
    const legacyConfig = parseToml(stripBom(await readFile(legacyConfigPath, "utf8"))) as XiraniteConfig
    const { config: currentConfig } = await loadXiraniteConfig({ configPath: targetConfigPath })
    const merged = mergeConfigRecords(legacyConfig, currentConfig) as XiraniteConfig
    await saveXiraniteConfig(merged, { configPath: targetConfigPath })
  } catch {
    // Keep an unmerged copy under the active data dir rather than leaving Roaming as a live source.
  }
  await movePath(legacyConfigPath, backupPath)
}

async function migrateLegacyArtifactsDir(legacyArtifactsDir: string, targetArtifactsDir: string, targetDataDir: string): Promise<void> {
  const legacyInfo = await stat(legacyArtifactsDir).catch(() => null)
  if (!legacyInfo?.isDirectory()) return

  if (!await pathExists(targetArtifactsDir)) {
    await movePath(legacyArtifactsDir, targetArtifactsDir)
    return
  }

  const backupDir = await uniquePath(join(targetDataDir, "migration-backups", "artifacts-legacy"))
  await moveDirectoryContents(legacyArtifactsDir, targetArtifactsDir, backupDir)
  await rm(legacyArtifactsDir, { recursive: true, force: true })
}

async function moveDirectoryContents(sourceDir: string, targetDir: string, backupDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true })
  const entries = await readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)
    const targetInfo = await stat(targetPath).catch(() => null)
    if (!targetInfo) {
      await movePath(sourcePath, targetPath)
      continue
    }
    if (entry.isDirectory() && targetInfo.isDirectory()) {
      await moveDirectoryContents(sourcePath, targetPath, join(backupDir, entry.name))
      continue
    }

    const backupPath = await uniquePath(join(backupDir, entry.name))
    await movePath(sourcePath, backupPath)
  }
}

async function movePath(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  try {
    await rename(sourcePath, targetPath)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
  }

  const info = await stat(sourcePath)
  if (info.isDirectory()) {
    await cp(sourcePath, targetPath, { recursive: true, errorOnExist: true, force: false })
  } else {
    await copyFile(sourcePath, targetPath)
  }
  await rm(sourcePath, { recursive: true, force: true })
}

async function uniquePath(path: string): Promise<string> {
  if (!await pathExists(path)) return path

  const ext = extname(path)
  const stem = ext ? path.slice(0, -ext.length) : path
  for (let index = 1; index < 1000; index += 1) {
    const candidate = ext ? `${stem}.${index}${ext}` : `${stem}.${index}`
    if (!await pathExists(candidate)) return candidate
  }
  return `${stem}.${Date.now()}${ext}`
}

async function removeDirectoryIfEmpty(path: string): Promise<void> {
  try {
    await rmdir(path)
  } catch {
    // The legacy app directory may still contain user files; only remove it when empty.
  }
}

function mergeConfigRecords(base: unknown, overlay: unknown): unknown {
  if (!isRecord(base) || !isRecord(overlay)) return overlay
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] = mergeConfigRecords(merged[key], value)
  }
  return merged
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function openPathWithSystemDefaultApp(filePath: string): Promise<void> {
  const { spawn } = await import("node:child_process")
  const platform = process.platform
  const command = platform === "win32" ? "explorer.exe" : platform === "darwin" ? "open" : "xdg-open"
  const args = [filePath]
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  child.unref()
}
