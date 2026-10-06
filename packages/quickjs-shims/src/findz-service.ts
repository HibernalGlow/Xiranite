/**
 * `@xiranite/findz-native`, as the QuickJS realm sees it.
 *
 * The real package calls into a shared library through `bun:ffi` (`packages/findz-native/src/index.ts`),
 * which a realm cannot do: the machine surface is a closed set of operations with no way to load a
 * native module (ADR-0077 §"Why a child at all"). The Findz core is Go (`native/findz-go`), so the host
 * starts it as a child the **run** owns and this module answers the same single export the core codes
 * against — `callFindz(method, params)` — by sending one frame through `service.invoke`.
 *
 * ## What is deliberately not here
 *
 * No method vocabulary of its own. The names come from the caller; the host checks them against
 * `crates/xiranite-quickjs-executor/src/findz_operations.rs`, whose list is pinned to
 * `native/findz-go/protocol.go`'s capability block. This file therefore adds a transport, not a second
 * description of the engine — the reason `watcher.apply_changes` is unreachable from a node is recorded
 * there, not here.
 *
 * ## Error shape
 *
 * The binding throws `` `${code}: ${message}` `` (`index.ts`'s `invoke`), so the core's reported failures
 * are the same text on both faces; a realm-only wording would make "same node, same bug" unprovable.
 */
import { opServiceInvokeAsync } from "./ops.ts"

const SERVICE = "findz"

/** The envelope `native/findz-go/serve.go` answers with. */
interface FindzEnvelope<T> {
  ok: boolean
  result?: T
  error?: { code?: string; message?: string }
}

export async function callFindz<T = unknown>(method: string, params: unknown): Promise<T> {
  const answer = await opServiceInvokeAsync<FindzEnvelope<T>>(SERVICE, method, params ?? {})
  if (!answer.ok) {
    throw new Error(`${answer.error?.code ?? "unknown"}: ${answer.error?.message ?? "the Findz core refused the request without a message"}`)
  }
  return answer.result as T
}

/** The face's info probe, answered by the engine itself rather than by this file's opinion. */
export async function getFindzNativeInfo(): Promise<unknown> {
  return await callFindz("api.info", {})
}
