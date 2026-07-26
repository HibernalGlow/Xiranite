import {
  matchingReaderInputBinding,
  type ReaderInputBindingsConfig,
  type ReaderInputContext,
  type ReaderInputDescriptor,
} from "../../domain/input/ReaderInputBindings.js"
import {
  executeReaderHeadlessInputAction,
  type ReaderHeadlessInputActionPort,
  type ReaderHeadlessInputActionResult,
} from "./ReaderHeadlessInputActionExecutor.js"
import { executeReaderInputActionSequence, type ReaderInputActionSequenceResult } from "../input/ReaderInputActionSequenceRunner.js"

export type ReaderHeadlessInputBindingResult =
  | {
      matched: false
      contexts: readonly ReaderInputContext[]
      reason: "binding-not-found"
    }
  | {
      matched: true
      bindingId: string
      context: ReaderInputContext
      action: ReaderHeadlessInputActionResult["action"]
      result: ReaderHeadlessInputActionResult
      sequence?: ReaderInputActionSequenceResult
    }

/** Resolves the canonical context stack before projecting an action onto a headless surface. */
export async function executeReaderHeadlessInputBinding(
  config: ReaderInputBindingsConfig,
  input: ReaderInputDescriptor,
  contexts: readonly ReaderInputContext[],
  controller: ReaderHeadlessInputActionPort,
  signal?: AbortSignal,
): Promise<ReaderHeadlessInputBindingResult> {
  signal?.throwIfAborted()
  const binding = matchingReaderInputBinding(config.bindings, input, contexts)
  if (!binding) return { matched: false, contexts, reason: "binding-not-found" }
  if (binding.followUpActions?.length) {
    const results: ReaderHeadlessInputActionResult[] = []
    const sequence = await executeReaderInputActionSequence(binding, async (action) => {
      const result = await executeReaderHeadlessInputAction(action, controller, signal)
      results.push(result)
      return result.handled ? { status: "succeeded" } : { status: "unavailable" }
    })
    signal?.throwIfAborted()
    if (sequence.outcome.status === "failed") throw sequence.outcome.error
    return { matched: true, bindingId: binding.id, context: binding.context, action: binding.action, result: results.at(-1)!, sequence }
  }
  const result = await executeReaderHeadlessInputAction(binding.action, controller, signal)
  return {
    matched: true,
    bindingId: binding.id,
    context: binding.context,
    action: binding.action,
    result,
  }
}
