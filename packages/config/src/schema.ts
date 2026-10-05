import { z } from "zod"

export interface Webview2Config {
  features: string[]
  switches: string[]
}

export const xiraniteConfigSchema = z.object({
  workspace: z.object({ default: z.string().optional() }).optional(),
  paths: z.object({
    data_dir: z.string().optional(),
    database: z.string().optional(),
  }).optional(),
  app: z.record(z.string(), z.unknown()).optional(),
  webview2: z.object({
    features: z.array(z.string()).default([]),
    switches: z.array(z.string()).default([]),
  }).optional(),
  nodes: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

export type XiraniteConfig = z.infer<typeof xiraniteConfigSchema>

export function getNodeConfig<NodeConfig = unknown>(config: XiraniteConfig, nodeId: string): NodeConfig | undefined {
  return config.nodes?.[nodeId] as NodeConfig | undefined
}

export function updateNodeConfig<NodeConfig>(config: XiraniteConfig, nodeId: string, patch: NodeConfig): XiraniteConfig {
  const next: XiraniteConfig = { ...config }
  const nodes = { ...next.nodes }
  nodes[nodeId] = mergeConfigValue(nodes[nodeId], patch)
  next.nodes = nodes
  return next
}

export function getAppConfig<AppConfig = unknown>(config: XiraniteConfig, section: string): AppConfig | undefined {
  return config.app?.[section] as AppConfig | undefined
}

export function updateAppConfig<AppConfig>(config: XiraniteConfig, section: string, patch: AppConfig): XiraniteConfig {
  const next: XiraniteConfig = { ...config }
  const app = { ...next.app }
  app[section] = mergeConfigValue(app[section], patch)
  next.app = app
  return next
}

export function getWebview2Config(config: XiraniteConfig): Webview2Config | undefined {
  return config.webview2
}

export function updateWebview2Config(config: XiraniteConfig, nextConfig: Webview2Config): XiraniteConfig {
  return {
    ...config,
    webview2: {
      features: [...new Set(nextConfig.features)],
      switches: [...new Set(nextConfig.switches)],
    },
  }
}

export function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function mergeConfigValue(current: unknown, patch: unknown): unknown {
  if (!isPlainRecord(current) || !isPlainRecord(patch)) return patch
  return {
    ...current,
    ...patch,
  }
}
