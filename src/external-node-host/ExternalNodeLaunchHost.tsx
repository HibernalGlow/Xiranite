import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { AppNodeEntry, ExternalNodeLaunchRequest, NodeHostApi } from "@xiranite/contract"

import { PACKAGE_MODULES } from "@/components/modules/packageModules.generated"
import { StandaloneNodeApp } from "@/node-app/StandaloneNodeApp"
import { publishExternalNodeLaunch } from "./externalNodeLaunchDelivery"

type HostInfo = { nodeId: string; snapshotId: string }
type HostAcknowledgement = { requestId: string; accepted: boolean; message?: string }

const externalNodeLaunchPollIntervalMs = 250

export function ExternalNodeLaunchHost() {
  const [info, setInfo] = useState<HostInfo>()
  const [request, setRequest] = useState<ExternalNodeLaunchRequest>()
  const [nodeHost, setNodeHost] = useState<{ entry: AppNodeEntry; host: NodeHostApi }>()
  const [error, setError] = useState<string>()
  const publishedRequestIdRef = useRef<string>()

  const receiveLaunch = useCallback((next: ExternalNodeLaunchRequest) => {
    setRequest((current) => current?.requestId === next.requestId ? current : next)
  }, [])

  useEffect(() => {
	let active = true
	let unsubscribe: (() => void) | undefined
	let poll: number | undefined
	const loadPendingLaunch = async () => {
		const pending = await callHost<ExternalNodeLaunchRequest | null>("ExternalNodeLaunchInitial")
		if (active && pending) receiveLaunch(pending)
	}
	void loadHostInfo().then(async (next) => {
		if (!active) return
      if (!next) {
        setError("This window was not started as an external node host.")
        return
		}
		setInfo(next)
		await loadPendingLaunch()
		if (active) poll = window.setInterval(() => { void loadPendingLaunch().catch(() => undefined) }, externalNodeLaunchPollIntervalMs)
	}).catch((cause: unknown) => {
		if (active) setError(messageOf(cause))
	})
	void subscribeToLaunches((next) => {
		if (active) receiveLaunch(next)
	}).then((stop) => { unsubscribe = stop }).catch(() => undefined)
	return () => {
		active = false
		if (poll !== undefined) window.clearInterval(poll)
		unsubscribe?.()
	}
	}, [receiveLaunch])

  const onHostReady = useCallback((next: { entry: AppNodeEntry; host: NodeHostApi }) => {
    setNodeHost(next)
  }, [])

  const declaration = useMemo(() => info
    ? PACKAGE_MODULES.find((node) => node.id === info.nodeId)?.externalLaunch
    : undefined, [info])

  useEffect(() => {
    if (!request || !nodeHost || !declaration) return
    if (publishedRequestIdRef.current === request.requestId) return
    const missing = declaration.requiredHostCapabilities.filter((capability) => !nodeHost.host.contract.hasCapability(capability))
    if (missing.length) {
      void acknowledge({ requestId: request.requestId, accepted: false, message: `The node host is missing required capabilities: ${missing.join(", ")}.` })
      setError(`The node host is missing required capabilities: ${missing.join(", ")}.`)
      return
    }
    // Keep the request outside the node subtree. A completed file launch can
    // persist node state and recreate that subtree before a reused process
    // delivers its next request.
    publishExternalNodeLaunch(request)
    publishedRequestIdRef.current = request.requestId
  }, [declaration, nodeHost, request])

  if (error) {
    return <main className="grid h-screen place-items-center bg-background p-6 text-foreground"><p role="alert" className="max-w-xl text-sm text-destructive">{error}</p></main>
  }
  if (!info) return <div className="h-screen bg-background" />
  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <StandaloneNodeApp nodeId={info.nodeId} snapshotId={info.snapshotId} onHostReady={onHostReady} />
    </main>
  )
}

export async function acknowledgeExternalNodeLaunch(requestId: string, accepted: boolean, message?: string): Promise<HostAcknowledgement> {
  return await acknowledge({ requestId, accepted, message })
}

async function loadHostInfo(): Promise<HostInfo | undefined> {
  return await callHost<HostInfo | null>("ExternalNodeLaunchHostInfo") ?? undefined
}

async function acknowledge(input: HostAcknowledgement): Promise<HostAcknowledgement> {
  return await callHost<HostAcknowledgement>("AcknowledgeExternalNodeLaunch", input)
}

async function subscribeToLaunches(onLaunch: (request: ExternalNodeLaunchRequest) => void): Promise<() => void> {
  if (typeof window === "undefined" || !window._wails) return () => undefined
  const runtime = await import("@wailsio/runtime")
  return runtime.Events.On("external-node-launch", (event: unknown) => {
    const data = isRecord(event) && "data" in event ? event.data : event
    if (isExternalNodeLaunchRequest(data)) onLaunch(data)
  })
}

async function callHost<T>(method: string, argument?: unknown): Promise<T> {
  if (typeof window === "undefined" || !window._wails) throw new Error("The Xiranite desktop host is unavailable.")
  const runtime = await import("@wailsio/runtime")
  return argument === undefined
    ? await runtime.Call.ByName(`main.XiraniteService.${method}`) as T
    : await runtime.Call.ByName(`main.XiraniteService.${method}`, argument) as T
}

function isExternalNodeLaunchRequest(value: unknown): value is ExternalNodeLaunchRequest {
  return isRecord(value)
    && value.version === 1
    && typeof value.requestId === "string"
    && typeof value.nodeId === "string"
    && typeof value.intent === "string"
    && Array.isArray(value.targets)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
