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

export class ConfigService {
  private readonly configPath: string | undefined

  constructor(options: { configPath?: string } = {}) {
    this.configPath = options.configPath
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
