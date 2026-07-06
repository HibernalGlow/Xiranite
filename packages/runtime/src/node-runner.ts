import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export interface NodeRunBridgeResponse<TData = unknown> {
  result: NodeRunResult<TData>
  events: NodeRunEvent[]
}

interface PlatformNodeSpec {
  loadCore: ModuleLoader
  run: string
  loadPlatform: ModuleLoader
  createRuntime: string
}

interface PureNodeSpec {
  loadCore: ModuleLoader
  run: string
  message: string
}

type NodeSpec = PlatformNodeSpec | PureNodeSpec
type NodeModule = Record<string, unknown>
type ModuleLoader = () => Promise<NodeModule>
type PlatformRunFunction = (
  input: unknown,
  runtime: unknown,
  onEvent: (event: NodeRunEvent) => void,
) => Promise<NodeRunResult>
type RuntimeFactory = () => unknown
type PureRunFunction = (input: unknown) => unknown

const nodeSpecs: Record<string, NodeSpec> = {
  bandia: platformNode(() => import("@xiranite/node-bandia/core"), "runBandia", () => import("@xiranite/node-bandia/platform"), "createNodeBandiaRuntime"),
  cleanf: platformNode(() => import("@xiranite/node-cleanf/core"), "runCleanf", () => import("@xiranite/node-cleanf/platform"), "createNodeCleanfRuntime"),
  crashu: platformNode(() => import("@xiranite/node-crashu/core"), "runCrashu", () => import("@xiranite/node-crashu/platform"), "createNodeCrashuRuntime"),
  dissolvef: platformNode(() => import("@xiranite/node-dissolvef/core"), "runDissolvef", () => import("@xiranite/node-dissolvef/platform"), "createNodeDissolvefRuntime"),
  encodeb: platformNode(() => import("@xiranite/node-encodeb/core"), "runEncodeb", () => import("@xiranite/node-encodeb/platform"), "createNodeEncodebRuntime"),
  enginev: platformNode(() => import("@xiranite/node-enginev/core"), "runEngineV", () => import("@xiranite/node-enginev/platform"), "createNodeEngineVRuntime"),
  findz: platformNode(() => import("@xiranite/node-findz/core"), "runFindz", () => import("@xiranite/node-findz/platform"), "createNodeFindzRuntime"),
  formatv: platformNode(() => import("@xiranite/node-formatv/core"), "runFormatv", () => import("@xiranite/node-formatv/platform"), "createNodeFormatvRuntime"),
  kavvka: platformNode(() => import("@xiranite/node-kavvka/core"), "runKavvka", () => import("@xiranite/node-kavvka/platform"), "createNodeKavvkaRuntime"),
  lata: platformNode(() => import("@xiranite/node-lata/core"), "runLata", () => import("@xiranite/node-lata/platform"), "createNodeLataRuntime"),
  linedup: pureNode(() => import("@xiranite/node-linedup/core"), "filterLines", "Filtered lines."),
  linku: platformNode(() => import("@xiranite/node-linku/core"), "runLinku", () => import("@xiranite/node-linku/platform"), "createNodeLinkuRuntime"),
  marku: platformNode(() => import("@xiranite/node-marku/core"), "runMarku", () => import("@xiranite/node-marku/platform"), "createNodeMarkuRuntime"),
  migratef: platformNode(() => import("@xiranite/node-migratef/core"), "runMigratef", () => import("@xiranite/node-migratef/platform"), "createNodeMigratefRuntime"),
  movea: platformNode(() => import("@xiranite/node-movea/core"), "runMovea", () => import("@xiranite/node-movea/platform"), "createNodeMoveaRuntime"),
  mvz: platformNode(() => import("@xiranite/node-mvz/core"), "runMvz", () => import("@xiranite/node-mvz/platform"), "createNodeMvzRuntime"),
  owithu: platformNode(() => import("@xiranite/node-owithu/core"), "runOwithu", () => import("@xiranite/node-owithu/platform"), "createNodeOwithuRuntime"),
  rawfilter: platformNode(() => import("@xiranite/node-rawfilter/core"), "runRawfilter", () => import("@xiranite/node-rawfilter/platform"), "createNodeRawfilterRuntime"),
  recycleu: platformNode(() => import("@xiranite/node-recycleu/core"), "runRecycleu", () => import("@xiranite/node-recycleu/platform"), "createNodeRecycleuRuntime"),
  reinstallp: platformNode(() => import("@xiranite/node-reinstallp/core"), "runReinstallp", () => import("@xiranite/node-reinstallp/platform"), "createNodeReinstallpRuntime"),
  repacku: platformNode(() => import("@xiranite/node-repacku/core"), "runRepacku", () => import("@xiranite/node-repacku/platform"), "createNodeRepackuRuntime"),
  scoolp: platformNode(() => import("@xiranite/node-scoolp/core"), "runScoolp", () => import("@xiranite/node-scoolp/platform"), "createNodeScoolpRuntime"),
  seriex: platformNode(() => import("@xiranite/node-seriex/core"), "runSeriex", () => import("@xiranite/node-seriex/platform"), "createNodeSeriexRuntime"),
  sleept: platformNode(() => import("@xiranite/node-sleept/core"), "runSleept", () => import("@xiranite/node-sleept/platform"), "createNodeSleeptRuntime"),
  trename: platformNode(() => import("@xiranite/node-trename/core"), "runTrename", () => import("@xiranite/node-trename/platform"), "createNodeTrenameRuntime"),
  weibospider: platformNode(() => import("@xiranite/node-weibospider/core"), "runWeiboSpider", () => import("@xiranite/node-weibospider/platform"), "createNodeWeiboSpiderRuntime"),
}

const moduleCache = new WeakMap<ModuleLoader, Promise<NodeModule>>()

function platformNode(loadCore: ModuleLoader, run: string, loadPlatform: ModuleLoader, createRuntime: string): PlatformNodeSpec {
  return {
    loadCore,
    run,
    loadPlatform,
    createRuntime,
  }
}

function pureNode(loadCore: ModuleLoader, run: string, message: string): PureNodeSpec {
  return {
    loadCore,
    run,
    message,
  }
}

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
): Promise<NodeRunResult> {
  const core = await loadModule(spec.loadCore)
  if (!isPlatformNode(spec)) {
    const run = getFunction<PureRunFunction>(core, spec.run)
    return { success: true, message: spec.message, data: run(input) }
  }

  const platform = await loadModule(spec.loadPlatform)
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

