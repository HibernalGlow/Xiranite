import { useCallback, useEffect, useRef, useState } from "react"
import type { NodeSchema } from "@xiranite/contract"
import { localBackendUrl, resolveLocalBackendConfig, type LocalBackendConfig } from "@/backend/localBackendConfig"

export function useNodeAppState(dataSchema: NodeSchema<Record<string, unknown>> | undefined, enabled: boolean) {
  const [data, setData] = useState<Record<string, unknown>>({})
  const [ready, setReady] = useState(false)
  const dataRef = useRef(data)
  const writeQueue = useRef(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    if (!enabled) {
      setReady(false)
      return () => { cancelled = true }
    }
    setReady(false)
    void requestState(dataSchema).then(async (next) => {
      const nextData = next.valid ? next.data : await replaceState({})
      if (cancelled) return
      dataRef.current = nextData
      setData(nextData)
      setReady(true)
    }).catch(() => {
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true }
  }, [dataSchema, enabled])

  const patchData = useCallback((patch: Record<string, unknown>) => {
    const optimistic = { ...dataRef.current, ...patch }
    dataRef.current = optimistic
    setData(optimistic)
    writeQueue.current = writeQueue.current
      .catch(() => undefined)
      .then(async () => {
        const persisted = await patchState(patch)
        dataRef.current = persisted
        setData(persisted)
      })
  }, [])

  return { data, patchData, ready }
}

async function requestState(dataSchema?: NodeSchema<Record<string, unknown>>): Promise<ParsedNodeAppState> {
  const config = resolveLocalBackendConfig()
  const response = await fetch(endpoint(config), {
    cache: "no-store",
    headers: config.token ? { "x-xiranite-token": config.token } : undefined,
  })
  if (!response.ok) throw new Error(`Could not load node application state (${response.status}).`)
  const body = await response.json() as { data?: unknown }
  return parseNodeAppState(body.data, dataSchema)
}

async function patchState(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = resolveLocalBackendConfig()
  const response = await fetch(endpoint(config), {
    method: "PATCH",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(config.token ? { "x-xiranite-token": config.token } : {}) },
    body: JSON.stringify({ patch }),
  })
  if (!response.ok) throw new Error(`Could not save node application state (${response.status}).`)
  const body = await response.json() as { data?: unknown }
  return isRecord(body.data) ? body.data : {}
}

async function replaceState(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = resolveLocalBackendConfig()
  const response = await fetch(endpoint(config), {
    method: "PUT",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(config.token ? { "x-xiranite-token": config.token } : {}) },
    body: JSON.stringify({ data }),
  })
  if (!response.ok) throw new Error(`Could not reset incompatible node application state (${response.status}).`)
  const body = await response.json() as { data?: unknown }
  return isRecord(body.data) ? body.data : {}
}

function endpoint(config: LocalBackendConfig): string {
  const url = localBackendUrl("/node-app/state", config)
  if (config.token) url.searchParams.set("token", config.token)
  return url.href
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export interface ParsedNodeAppState {
  data: Record<string, unknown>
  valid: boolean
}

export function parseNodeAppState(value: unknown, schema?: NodeSchema<Record<string, unknown>>): ParsedNodeAppState {
  if (!isRecord(value)) return { data: {}, valid: false }
  if (!schema) return { data: value, valid: true }
  if (schema.safeParse) {
    const parsed = schema.safeParse(value)
    return parsed.success && isRecord(parsed.data) ? { data: parsed.data, valid: true } : { data: {}, valid: false }
  }
  try {
    const parsed = schema.parse(value)
    return isRecord(parsed) ? { data: parsed, valid: true } : { data: {}, valid: false }
  } catch {
    return { data: {}, valid: false }
  }
}
