import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

import { generatedNodeSpecs } from "./node-runner.generated.js"
import type { ModuleLoader, NodeModule } from "./node-module-loader.js"
import { prepareNodePackage } from "./node-preparer.js"

export interface NodeRunBridgeResponse<TData = unknown> {
  result: NodeRunResult<TData>
  events: NodeRunEvent[]
}

export interface PlatformNodeSpec {
  packageName: string
  loadCore: ModuleLoader
  run: string
  loadPlatform: ModuleLoader
  createRuntime: string
}

export interface PureNodeSpec {
  packageName: string
  loadCore: ModuleLoader
  run: string
  message: string
}

export type NodeSpec = PlatformNodeSpec | PureNodeSpec
type PlatformRunFunction = (
  input: unknown,
  runtime: unknown,
  onEvent: (event: NodeRunEvent) => void,
) => Promise<NodeRunResult>
type RuntimeFactory = () => unknown
export interface NodeRunControl {
  isCancelled: () => boolean
  waitWhilePaused: () => Promise<void>
}
type PureRunFunction = (input: unknown) => unknown

const moduleCache = new WeakMap<ModuleLoader, Promise<NodeModule>>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPlatformNode(spec: NodeSpec): spec is PlatformNodeSpec {
  return "loadPlatform" in spec
}

async function loadModule(loader: ModuleLoader): Promise<NodeModule> {
  if (!moduleCache.has(loader)) {
    moduleCache.set(loader, loader())
  }
  return moduleCache.get(loader)!
}

function getFunction<TFunction>(module: NodeModule, exportName: string): TFunction {
  const value = module[exportName]
  if (typeof value !== "function") {
    throw new Error(`Missing function export "${exportName}".`)
  }
  return value as TFunction
}

async function runSpec(
  spec: NodeSpec,
  input: unknown,
  onEvent: (event: NodeRunEvent) => void,
  control?: NodeRunControl,
): Promise<NodeRunResult> {
  if (process.env.XIRANITE_LAZY_NODE_BUILD === "1") {
    onEvent({ type: "log", message: `Preparing ${spec.packageName}…` })
    await prepareNodePackage(spec.packageName)
  }
  const core = await loadModule(spec.loadCore)
  if (!isPlatformNode(spec)) {
    const run = getFunction<PureRunFunction>(core, spec.run)
    return { success: true, message: spec.message, data: run(input) }
  }

  const platform = await loadModule(spec.loadPlatform)
  const run = getFunction<PlatformRunFunction>(core, spec.run)
  const createRuntime = getFunction<RuntimeFactory>(platform, spec.createRuntime)
  const runtime = createRuntime()
  const controlledRuntime = control && runtime && typeof runtime === "object"
    ? { ...runtime, isCancelled: control.isCancelled, waitWhilePaused: control.waitWhilePaused }
    : runtime
  return run(input, controlledRuntime, onEvent)
}

export async function runNodeFromMain(payload: unknown): Promise<NodeRunBridgeResponse> {
  const { nodeId, input } = payload as { nodeId?: unknown; input?: unknown }
  const events: NodeRunEvent[] = []
  const onEvent = (event: NodeRunEvent) => events.push(event)

  const result = await runNodeWithEvents(nodeId, input, onEvent)
  return { result, events }
}

export async function runNodeWithEvents(
  nodeId: unknown,
  input: unknown,
  onEvent: (event: NodeRunEvent) => void = () => {},
  control?: NodeRunControl,
): Promise<NodeRunResult> {
  if (typeof nodeId !== "string" || !nodeId) {
    return { success: false, message: "node.run requires a nodeId string." }
  }

  const spec = generatedNodeSpecs[nodeId]
  if (!spec) {
    return {
      success: false,
      message: `Unknown node runner "${nodeId}". Available: ${Object.keys(generatedNodeSpecs).sort().join(", ")}`,
    }
  }

  try {
    return await runSpec(spec, input, onEvent, control)
  } catch (error) {
    const message = `Node "${nodeId}" failed: ${errorMessage(error)}`
    onEvent({ type: "log", message })
    return { success: false, message }
  }
}

