import type { NexusCaptureDTO } from "@xiranite/shared"
import { resolveLocalBackendConfig } from "./localBackendConfig"

export async function listNexusCaptures(targetNodeId: string): Promise<NexusCaptureDTO[]> {
  const config = resolveLocalBackendConfig()
  const url = new URL("/nexus/captures", config.baseUrl)
  url.searchParams.set("targetNodeId", targetNodeId)
  const response = await fetch(url, {
    cache: "no-store",
    headers: config.token ? { "x-xiranite-token": config.token } : undefined,
  })
  if (!response.ok) throw new Error(await response.text().catch(() => `Nexus inbox returned ${response.status}.`))
  const body = await response.json() as { captures?: NexusCaptureDTO[] }
  return Array.isArray(body.captures) ? body.captures : []
}

export async function removeNexusCapture(id: string): Promise<boolean> {
  const config = resolveLocalBackendConfig()
  const url = new URL(`/nexus/captures/${encodeURIComponent(id)}`, config.baseUrl)
  const response = await fetch(url, {
    method: "DELETE",
    cache: "no-store",
    headers: config.token ? { "x-xiranite-token": config.token } : undefined,
  })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(await response.text().catch(() => `Nexus inbox returned ${response.status}.`))
  const body = await response.json() as { removed?: boolean }
  return body.removed === true
}
