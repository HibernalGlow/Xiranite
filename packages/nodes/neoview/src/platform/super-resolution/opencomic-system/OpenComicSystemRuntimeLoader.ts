import type { OpenComicSystemRuntime } from "./OpenComicAiSystemProvider.js"

export const OPENCOMIC_SYSTEM_PACKAGE = "@hibernalglow/opencomic-ai-system"

export interface OpenComicSystemRuntimeLoaderOptions {
  packageName?: string
  importModule?: (specifier: string) => Promise<unknown>
}

export class OpenComicSystemRuntimeUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "OpenComicSystemRuntimeUnavailableError"
  }
}

export async function loadOpenComicSystemRuntime(
  options: OpenComicSystemRuntimeLoaderOptions = {},
): Promise<OpenComicSystemRuntime> {
  const packageName = options.packageName?.trim() || OPENCOMIC_SYSTEM_PACKAGE
  let imported: unknown
  try {
    imported = await (options.importModule ?? importRuntimeModule)(packageName)
  } catch (error) {
    throw new OpenComicSystemRuntimeUnavailableError(`OpenComic system runtime is unavailable: ${packageName}`, { cause: error })
  }
  const module = isRecord(imported) ? imported : undefined
  const runtime = module?.default ?? module?.OpenComicAI
  if (!isOpenComicSystemRuntime(runtime)) {
    throw new OpenComicSystemRuntimeUnavailableError(`OpenComic system runtime has an incompatible API: ${packageName}`)
  }
  return runtime
}

async function importRuntimeModule(specifier: string): Promise<unknown> {
  return await import(specifier)
}

function isOpenComicSystemRuntime(value: unknown): value is OpenComicSystemRuntime {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false
  const runtime = value as Partial<OpenComicSystemRuntime>
  return Array.isArray(runtime.modelsList)
    && runtime.modelsList.every((model) => typeof model === "string")
    && typeof runtime.model === "function"
    && typeof runtime.setBinaryResolver === "function"
    && typeof runtime.setModelsPath === "function"
    && typeof runtime.setConcurrentDaemons === "function"
    && typeof runtime.setDaemonIdleTimeout === "function"
    && typeof runtime.pipeline === "function"
    && typeof runtime.closeAllProcesses === "function"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
