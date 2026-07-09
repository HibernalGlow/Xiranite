import { access, mkdir, writeFile } from "node:fs/promises"
import { dirname, extname } from "node:path"
import {
  getAppConfig,
  getNodeConfig,
  loadXiraniteConfig,
  parseToml,
  resolveXiraniteConfigPath,
  saveXiraniteConfig,
  stripBom,
  updateAppConfig,
  updateNodeConfig,
  type XiraniteConfig,
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
  private readonly openPath: OpenPathHandler
  private readonly history?: NodeRunHistoryService

  constructor(options: {
    configPath?: string
    databasePath?: string
    dataDir?: string
    openPath?: OpenPathHandler
    history?: NodeRunHistoryService
  } = {}) {
    this.configPath = options.configPath
    this.databasePath = options.databasePath
    this.dataDir = options.dataDir
    this.openPath = options.openPath ?? openPathWithSystemDefaultApp
    this.history = options.history
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

  getConfigPath(): string {
    return resolveXiraniteConfigPath(this.resolveOptions())
  }

  async ensureConfigFile(): Promise<EnsureConfigFileResult> {
    const startedAt = Date.now()
    const path = this.getConfigPath()
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

  private resolveOptions(): ResolveConfigPathOptions {
    return {
      configPath: this.configPath,
      databasePath: this.databasePath,
      dataDir: this.dataDir,
    }
  }
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
