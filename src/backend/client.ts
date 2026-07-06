import { createWailsRuntime, detectWails } from "./adapters/wails"
import { createWebRuntime } from "./adapters/web"
import type { RuntimeAdapterRegistration, RuntimeInterface } from "./runtime/runtime"
import { createBackend, type Backend } from "./services"

const RUNTIME_FACTORIES: RuntimeAdapterRegistration[] = [
  { kind: "wails", detect: detectWails, factory: createWailsRuntime },
  { kind: "web", detect: () => true, factory: createWebRuntime },
]

let runtimePromise: Promise<RuntimeInterface> | null = null
let backendPromise: Promise<Backend> | null = null

function selectRuntime(): Promise<RuntimeInterface> {
  if (runtimePromise) return runtimePromise

  runtimePromise = (async () => {
    for (const registration of RUNTIME_FACTORIES) {
      try {
        if (registration.detect()) {
          const runtime = await registration.factory()
          console.info(`[backend] runtime = ${runtime.kind}`)
          return runtime
        }
      } catch (error) {
        console.warn(`[backend] runtime ${registration.kind} detect/init failed:`, error)
      }
    }

    throw new Error("No runtime available")
  })()

  return runtimePromise
}

export function getBackend(): Promise<Backend> {
  if (backendPromise) return backendPromise
  backendPromise = selectRuntime().then((runtime) => createBackend({ runtime }))
  return backendPromise
}

export async function getRuntime(): Promise<RuntimeInterface> {
  return selectRuntime()
}

export type { Backend } from "./services"
