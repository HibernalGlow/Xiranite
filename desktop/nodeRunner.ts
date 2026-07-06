import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export interface NodeRunBridgeResponse<TData = unknown> {
  result: NodeRunResult<TData>
  events: NodeRunEvent[]
}

interface PlatformNodeSpec {
  core: string
  run: string
  platform: string
  createRuntime: string
}

interface PureNodeSpec {
  core: string
  run: string
  message: string
}

type NodeSpec = PlatformNodeSpec | PureNodeSpec
type NodeModule = Record<string, unknown>
type PlatformRunFunction = (
  input: unknown,
  runtime: unknown,
  onEvent: (event: NodeRunEvent) => void,
) => Promise<NodeRunResult>
type RuntimeFactory = () => unknown
type PureRunFunction = (input: unknown) => unknown

const nodeSpecs: Record<string, NodeSpec> = {
  bandia: platformNode("bandia", "runBandia", "createNodeBandiaRuntime"),
  cleanf: platformNode("cleanf", "runCleanf", "createNodeCleanfRuntime"),
  crashu: platformNode("crashu", "runCrashu", "createNodeCrashuRuntime"),
  dissolvef: platformNode("dissolvef", "runDissolvef", "createNodeDissolvefRuntime"),
  encodeb: platformNode("encodeb", "runEncodeb", "createNodeEncodebRuntime"),
  enginev: platformNode("enginev", "runEngineV", "createNodeEngineVRuntime"),
  findz: platformNode("findz", "runFindz", "createNodeFindzRuntime"),
  formatv: platformNode("formatv", "runFormatv", "createNodeFormatvRuntime"),
  kavvka: platformNode("kavvka", "runKavvka", "createNodeKavvkaRuntime"),
  lata: platformNode("lata", "runLata", "createNodeLataRuntime"),
  linedup: pureNode("linedup", "filterLines", "Filtered lines."),
  linku: platformNode("linku", "runLinku", "createNodeLinkuRuntime"),
  marku: platformNode("marku", "runMarku", "createNodeMarkuRuntime"),
  migratef: platformNode("migratef", "runMigratef", "createNodeMigratefRuntime"),
  movea: platformNode("movea", "runMovea", "createNodeMoveaRuntime"),
  mvz: platformNode("mvz", "runMvz", "createNodeMvzRuntime"),
  owithu: platformNode("owithu", "runOwithu", "createNodeOwithuRuntime"),
  rawfilter: platformNode("rawfilter", "runRawfilter", "createNodeRawfilterRuntime"),
  recycleu: platformNode("recycleu", "runRecycleu", "createNodeRecycleuRuntime"),
  reinstallp: platformNode("reinstallp", "runReinstallp", "createNodeReinstallpRuntime"),
  repacku: platformNode("repacku", "runRepacku", "createNodeRepackuRuntime"),
  scoolp: platformNode("scoolp", "runScoolp", "createNodeScoolpRuntime"),
  seriex: platformNode("seriex", "runSeriex", "createNodeSeriexRuntime"),
  sleept: platformNode("sleept", "runSleept", "createNodeSleeptRuntime"),
  trename: platformNode("trename", "runTrename", "createNodeTrenameRuntime"),
  weibospider: platformNode("weibospider", "runWeiboSpider", "createNodeWeiboSpiderRuntime"),
}

const moduleCache = new Map<string, Promise<NodeModule>>()

function platformNode(packageName: string, run: string, createRuntime: string): PlatformNodeSpec {
  return {
    core: `../packages/nodes/${packageName}/src/core.ts`,
    run,
    platform: `../packages/nodes/${packageName}/src/platform.ts`,
    createRuntime,
  }
}

function pureNode(packageName: string, run: string, message: string): PureNodeSpec {
  return {
    core: `../packages/nodes/${packageName}/src/core.ts`,
    run,
    message,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPlatformNode(spec: NodeSpec): spec is PlatformNodeSpec {
  return "platform" in spec
}

async function loadModule(modulePath: string): Promise<NodeModule> {
  if (!moduleCache.has(modulePath)) {
    moduleCache.set(modulePath, import(modulePath) as Promise<NodeModule>)
  }
  return moduleCache.get(modulePath)!
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
): Promise<NodeRunResult> {
  const core = await loadModule(spec.core)
  if (!isPlatformNode(spec)) {
    const run = getFunction<PureRunFunction>(core, spec.run)
    return { success: true, message: spec.message, data: run(input) }
  }

  const platform = await loadModule(spec.platform)
  const run = getFunction<PlatformRunFunction>(core, spec.run)
  const createRuntime = getFunction<RuntimeFactory>(platform, spec.createRuntime)
  return run(input, createRuntime(), onEvent)
}

export async function runNodeFromMain(payload: unknown): Promise<NodeRunBridgeResponse> {
  const { nodeId, input } = payload as { nodeId?: unknown; input?: unknown }
  const events: NodeRunEvent[] = []
  const onEvent = (event: NodeRunEvent) => events.push(event)

  if (typeof nodeId !== "string" || !nodeId) {
    return {
      result: { success: false, message: "node.run requires a nodeId string." },
      events,
    }
  }

  const spec = nodeSpecs[nodeId]
  if (!spec) {
    return {
      result: {
        success: false,
        message: `Unknown node runner "${nodeId}". Available: ${Object.keys(nodeSpecs).sort().join(", ")}`,
      },
      events,
    }
  }

  try {
    const result = await runSpec(spec, input, onEvent)
    return { result, events }
  } catch (error) {
    const message = `Node "${nodeId}" failed: ${errorMessage(error)}`
    events.push({ type: "log", message })
    return {
      result: { success: false, message },
      events,
    }
  }
}
