import { hostCapabilities } from "@xiranite/host-capabilities"
import type { FindzRuntime } from "./core.js"
import type { FindzError, FindzMethod, FindzResponse } from "./protocol.js"

/** The service name the host's `HostService` table answers; see `findz_operations.rs`' `PROGRAM`. */
const SERVICE = "findz"

/**
 * The Findz core's platform half: one engine frame per call, answered by the Go sidecar this run owns.
 *
 * `service.invoke` is the only door a realm node has (the machine surface is a closed set with no way to
 * load a native module), and the host checks `method` against its own pinned copy of
 * `native/findz-go/protocol.go`'s capability list — so this file carries a transport, not a second
 * description of the engine. `watcher.apply_changes`/`watcher.set_health` are refused there, which is why
 * they are absent from `FindzMethod` rather than filtered here.
 *
 * ## Error shape
 *
 * A refusal becomes `` `${code}: ${message}` ``, matching what the old `bun:ffi` binding threw, so the
 * same engine bug reads the same on every face and the core's reported failures stay comparable.
 */
export function createNodeFindzRuntime(): FindzRuntime {
  return {
    findz: {
      async call<T>(method: FindzMethod, params: unknown): Promise<T> {
        const answer = (await hostCapabilities.service.invoke(
          SERVICE,
          method,
          (params ?? {}) as Record<string, unknown>,
        )) as FindzResponse<T>
        if (!answer.ok) {
          const error: FindzError | undefined = answer.error
          throw new Error(`${error?.code ?? "unknown"}: ${error?.message ?? "the Findz core refused the request without a message"}`)
        }
        return answer.result
      },
    },
  }
}
