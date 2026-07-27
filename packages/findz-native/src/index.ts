import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveNativeBindingPath } from "@xiranite/native-loader"
import { readFindzNativeResponse, type FindzNativePointer } from "./native-response.js"
import {
  FINDZ_ABI_VERSION,
  FINDZ_REQUEST_VERSION,
  type FindzApiInfo,
  type FindzArchiveQuery,
  type FindzArchiveRow,
  type FindzLibraryOpenParams,
  type FindzLibrarySummary,
  type FindzMemberRow,
  type FindzNativeClient,
  type FindzPagedResult,
  type FindzResponse,
  type FindzTask,
  type FindzTreemapNode,
} from "./protocol.js"

export * from "./protocol.js"

type NativeSymbols = {
  findz_abi_version(): number
  findz_api_info(responseLength: Pointer): Pointer
  findz_call(request: Pointer, requestLength: bigint, responseLength: Pointer): Pointer
  findz_free(response: Pointer): void
}

type NativeLibrary = {
  symbols: NativeSymbols
  close(): void
}

type Pointer = FindzNativePointer

type FindzFfi = {
  dlopen(path: string, symbols: Record<string, unknown>): NativeLibrary
  ptr(value: Uint8Array | BigUint64Array): Pointer
  toArrayBuffer(pointer: Pointer, byteOffset: number, length: number): ArrayBuffer
}

let cachedClient: FindzNativeClient | undefined

export function loadFindzNativeClient(): FindzNativeClient {
  if (cachedClient) return cachedClient
  cachedClient = createFindzNativeClient(resolveFindzNativePath())
  return cachedClient
}

export function resolveFindzNativePath(): string {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
  const bindingPath = resolveNativeBindingPath({
    id: "findz",
    filename: "findz.dll",
    overrideEnv: "XIRANITE_FINDZ_NATIVE_PATH",
    workspaceRoot: resolve(packageRoot, "..", ".."),
  })
  if (!existsSync(bindingPath)) {
    throw new Error(`Xiranite Findz native core was not found at ${bindingPath}. Run \"bun run --cwd packages/findz-native build:native\" first.`)
  }
  return bindingPath
}

export async function getFindzNativeInfo(): Promise<FindzApiInfo> {
  const client = loadFindzNativeClient()
  return await client.getApiInfo()
}

function createFindzNativeClient(bindingPath: string): FindzNativeClient {
  let nativeLibrary: NativeLibrary | undefined
  let ffi: FindzFfi | undefined
  let apiInfo: FindzApiInfo | undefined
  let callQueue = Promise.resolve()
  let sequence = 0

  const invoke = async <T>(method: string, params: unknown): Promise<T> => {
    const operation = callQueue.then(async () => {
      const library = await openLibrary()
      const requestId = `findz-${++sequence}`
      const request = new TextEncoder().encode(JSON.stringify({ requestVersion: FINDZ_REQUEST_VERSION, requestId, method, params }))
      const responseLength = new BigUint64Array(1)
      const response = readFindzNativeResponse(ffi!, library.symbols, library.symbols.findz_call(ffi!.ptr(request), BigInt(request.byteLength), ffi!.ptr(responseLength)), responseLength)
      const parsed = parseNativeResponse<T>(response)
      if (!parsed.ok) throw new Error(`${parsed.error.code}: ${parsed.error.message}`)
      return parsed.result
    })
    callQueue = operation.then(() => undefined, () => undefined)
    return await operation
  }

  const openLibrary = async (): Promise<NativeLibrary> => {
    if (nativeLibrary) return nativeLibrary
    if (!process.versions.bun) throw new Error("Findz native core requires Bun's bun:ffi runtime.")
    ffi ??= await import("bun:ffi") as unknown as FindzFfi
    const loaded = ffi.dlopen(bindingPath, {
      findz_abi_version: { args: [], returns: "u32" },
      findz_api_info: { args: ["ptr"], returns: "ptr" },
      findz_call: { args: ["ptr", "usize", "ptr"], returns: "ptr" },
      findz_free: { args: ["ptr"], returns: "void" },
    }) as unknown as NativeLibrary
    if (loaded.symbols.findz_abi_version() !== FINDZ_ABI_VERSION) {
      loaded.close()
      throw new Error(`Findz native ABI mismatch at ${bindingPath}.`)
    }
    nativeLibrary = loaded
    const responseLength = new BigUint64Array(1)
    const response = readFindzNativeResponse(ffi, loaded.symbols, loaded.symbols.findz_api_info(ffi.ptr(responseLength)), responseLength)
    const parsed = parseNativeResponse<FindzApiInfo>(response)
    if (!parsed.ok) {
      loaded.close()
      nativeLibrary = undefined
      throw new Error(`${parsed.error.code}: ${parsed.error.message}`)
    }
    if (!parsed.result.requestVersions.includes(FINDZ_REQUEST_VERSION)) {
      loaded.close()
      nativeLibrary = undefined
      throw new Error(`Findz native core does not support request version ${FINDZ_REQUEST_VERSION}.`)
    }
    apiInfo = parsed.result
    return loaded
  }

  return {
    async getApiInfo() {
      await openLibrary()
      return apiInfo!
    },
    openLibrary: (params) => invoke<FindzLibrarySummary>("library.open", params),
    closeLibrary: async (libraryId) => {
      await invoke<{ libraryId: string }>("library.close", { libraryId })
    },
    startScan: (libraryId) => invoke<FindzTask>("scan.start", { libraryId }),
    applyWatcherChanges: (libraryId, changes) => invoke<FindzTask>("watcher.apply_changes", { libraryId, changes }),
    setWatcherHealth: (libraryId, health) => invoke<FindzLibrarySummary>("watcher.set_health", { libraryId, health }),
    startAnalysis: (libraryId, scope = { kind: "all" }) => invoke<FindzTask>("analysis.start", { libraryId, scope }),
    getTask: (libraryId, taskId) => invoke<FindzTask>("task.get", { libraryId, taskId }),
    pauseTask: (libraryId, taskId) => invoke<FindzTask>("task.pause", { libraryId, taskId }),
    resumeTask: (libraryId, taskId) => invoke<FindzTask>("task.resume", { libraryId, taskId }),
    cancelTask: (libraryId, taskId) => invoke<FindzTask>("task.cancel", { libraryId, taskId }),
    queryArchives: (params: FindzArchiveQuery) => invoke<FindzPagedResult<FindzArchiveRow>>("query.archives", params),
    exportRows: (params: FindzArchiveQuery) => invoke<FindzPagedResult<FindzArchiveRow>>("export.rows", params),
    queryMembers: (params) => invoke<FindzPagedResult<FindzMemberRow>>("query.members", params),
    getTreemap: (params) => invoke<FindzTreemapNode>("projection.treemap", params),
    close() {
      nativeLibrary?.close()
      nativeLibrary = undefined
      apiInfo = undefined
    },
  }
}

function parseNativeResponse<T>(response: string): FindzResponse<T> {
  try {
    return JSON.parse(response) as FindzResponse<T>
  } catch (error) {
    throw new Error(`Findz native core returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}
