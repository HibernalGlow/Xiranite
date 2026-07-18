import { createXiraniteNodeRunHistoryClient } from "@xiranite/api/client"
import type {
  NodeRunHistoryClearQueryDTO,
  NodeRunHistoryClearResultDTO,
  NodeRunHistoryItemDTO,
  NodeRunHistoryListDTO,
  NodeRunHistoryQueryDTO,
} from "@xiranite/shared"
import { resolveLocalBackendConfig, type LocalBackendConfig } from "./localBackendConfig"

let historyClient: ReturnType<typeof createXiraniteNodeRunHistoryClient> | null = null
let historyClientKey: string | null = null

export async function listNodeRunHistory(
  query: NodeRunHistoryQueryDTO,
): Promise<NodeRunHistoryListDTO> {
  return getHistoryClient().list(query)
}

export async function getNodeRunHistory(
  id: string,
): Promise<NodeRunHistoryItemDTO> {
  return getHistoryClient().get(id)
}

export async function deleteNodeRunHistory(id: string): Promise<void> {
  await getHistoryClient().delete(id)
}

export async function clearNodeRunHistory(
  query: NodeRunHistoryClearQueryDTO,
): Promise<NodeRunHistoryClearResultDTO> {
  return getHistoryClient().clear(query)
}

function getHistoryClient() {
  const config = resolveLocalBackendConfig()
  const key = historyClientCacheKey(config)
  if (historyClient && historyClientKey === key) return historyClient

  historyClient = createXiraniteNodeRunHistoryClient(config.baseUrl, { token: config.token })
  historyClientKey = key
  return historyClient
}

function historyClientCacheKey(config: LocalBackendConfig): string {
  return `${config.baseUrl}\n${config.token ?? ""}`
}
