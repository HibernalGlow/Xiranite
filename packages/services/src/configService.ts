import { access, mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {
  getNodeConfig,
  loadXiraniteConfig,
  parseToml,
  resolveXiraniteConfigPath,
  saveXiraniteConfig,
  stripBom,
  updateNodeConfig,
  type XiraniteConfig,
} from "@xiranite/config"

export interface GetNodeConfigResult {
  config: unknown | undefined
  path: string
}

export interface UpdateNodeConfigResult {
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
  private readonly openPath: OpenPathHandler

  constructor(options: { configPath?: string; openPath?: OpenPathHandler } = {}) {
    this.configPath = options.configPath
    this.openPath = options.openPath ?? openPathWithSystemDefaultApp
  }

  async getConfig(): Promise<GetConfigResult> {
    const { config, path } = await loadXiraniteConfig({ configPath: this.configPath })
    return { config, path }
  }

  async getNodeConfig(nodeId: string): Promise<GetNodeConfigResult> {
    const { config, path } = await loadXiraniteConfig({ configPath: this.configPath })
    return { config: getNodeConfig(config, nodeId), path }
  }

  async updateNodeConfig(nodeId: string, patch: unknown): Promise<UpdateNodeConfigResult> {
    const { config, path } = await loadXiraniteConfig({ configPath: this.configPath })
    const updated = updateNodeConfig(config, nodeId, patch)
    await saveXiraniteConfig(updated, { configPath: this.configPath })
    return { config: patch, path }
  }

  getConfigPath(): string {
    return resolveXiraniteConfigPath({ configPath: this.configPath })
  }

  async ensureConfigFile(): Promise<EnsureConfigFileResult> {
    const path = this.getConfigPath()
    try {
      await access(path)
      return { path, created: false }
    } catch {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, CONFIG_TEMPLATE, "utf8")
      return { path, created: true }
    }
  }

  async openConfigFile(): Promise<OpenConfigFileResult> {
    const { config, path } = await loadXiraniteConfig({ configPath: this.configPath })
    await saveXiraniteConfig(config, { configPath: this.configPath })
    await this.openPath(path)
    return { opened: true, path }
  }

  async importLegacy(legacyPath: string, nodeId: string): Promise<ImportLegacyResult> {
    const { readFile } = await import("node:fs/promises")

    let content: string
    try {
      content = await readFile(legacyPath, "utf8")
    } catch {
      return { imported: false, config: undefined, path: legacyPath }
    }

    const parsed = parseToml(stripBom(content)) as Record<string, unknown>
    const nodeValue = (parsed.nodes as Record<string, unknown> | undefined)?.[nodeId] ?? parsed[nodeId] ?? parsed

    const { config, path } = await loadXiraniteConfig({ configPath: this.configPath })
    const updated = updateNodeConfig(config, nodeId, nodeValue)
    await saveXiraniteConfig(updated, { configPath: this.configPath })

    return { imported: true, config: nodeValue, path }
  }
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
