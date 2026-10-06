import type { LocalBackendStatus } from "./localBackendStatus"

interface DiagnosticBackendConfig {
  baseUrl?: string
  instanceId?: string
}

declare global {
  interface Window {
    __XIRANITE_BACKEND__?: DiagnosticBackendConfig & { token?: string }
    __xiraniteDebug?: {
      events?: readonly unknown[]
    }
  }
}

export function formatLocalBackendDiagnostics(status: LocalBackendStatus | undefined): string {
  const injectedConfig = typeof window === "undefined" ? undefined : window.__XIRANITE_BACKEND__
  const startupEvents = typeof window === "undefined" ? undefined : window.__xiraniteDebug?.events
  const lines = [
    "Xiranite local backend diagnostic",
    `capturedAt=${new Date().toISOString()}`,
    `status=${status?.status ?? "unknown"}`,
    `error=${status?.error ?? "<none>"}`,
    `runtime=${formatJson(status?.runtime ?? null)}`,
    `statusConfig=${formatJson(sanitizeConfig(status?.config))}`,
    `injectedConfig=${formatJson(sanitizeConfig(injectedConfig))}`,
    `location=${typeof window === "undefined" ? "<non-browser>" : window.location.href}`,
    `userAgent=${typeof navigator === "undefined" ? "<unknown>" : navigator.userAgent}`,
  ]

  if (startupEvents?.length) {
    lines.push(`startupDebugEvents=${formatJson(startupEvents.slice(-50))}`)
  } else {
    lines.push("startupDebugEvents=<none>")
  }

  return lines.join("\n")
}

function sanitizeConfig(config: DiagnosticBackendConfig | undefined): DiagnosticBackendConfig | null {
  if (!config) return null
  return {
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.instanceId ? { instanceId: config.instanceId } : {}),
  }
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, nestedValue) => {
      if (nestedValue instanceof Error) {
        return { name: nestedValue.name, message: nestedValue.message, stack: nestedValue.stack }
      }
      if (typeof nestedValue === "bigint") return `${nestedValue}n`
      return nestedValue
    }) ?? "null"
  } catch {
    return "<unserializable>"
  }
}
