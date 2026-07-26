import type { ReaderInputAction } from "../../domain/input/ReaderInputActions.js"
import { readerInputBindingActions, type ReaderInputBinding } from "../../domain/input/ReaderInputBindings.js"

export type ReaderInputActionOutcome =
  | { status: "succeeded"; consumedAction?: ReaderInputAction }
  | { status: "cancelled" }
  | { status: "unavailable" }
  | { status: "failed"; error: unknown }

export interface ReaderInputActionExecutionContext {
  bindingId: string
  index: number
  nextAction?: ReaderInputAction
  previousOutcome?: ReaderInputActionOutcome
}

export interface ReaderInputActionSequenceResult {
  bindingId: string
  status: ReaderInputActionOutcome["status"]
  completedActions: number
  action: ReaderInputAction
  outcome: ReaderInputActionOutcome
}

export type ReaderInputActionOperation = (
  action: ReaderInputAction,
  context: ReaderInputActionExecutionContext,
) => ReaderInputActionOutcome | void | Promise<ReaderInputActionOutcome | void>

class ReaderInputActionSequenceHalt extends Error {
  constructor(readonly result: ReaderInputActionSequenceResult) {
    super(`Reader input action sequence stopped with ${result.status}.`)
    this.name = "ReaderInputActionSequenceHalt"
  }
}

/** Serializes configured actions while keeping stop semantics in NeoView's domain contract. */
export async function executeReaderInputActionSequence(
  binding: ReaderInputBinding,
  execute: ReaderInputActionOperation,
): Promise<ReaderInputActionSequenceResult> {
  const actions = readerInputBindingActions(binding)
  let completedActions = 0
  let previousOutcome: ReaderInputActionOutcome | undefined

  const executeAt = async (action: ReaderInputAction, index: number): Promise<ReaderInputActionOutcome> => {
    let outcome: ReaderInputActionOutcome
    try {
      outcome = await execute(action, {
        bindingId: binding.id,
        index,
        nextAction: actions[index + 1],
        previousOutcome,
      }) ?? { status: "succeeded" }
    } catch (error) {
      outcome = { status: "failed", error }
    }
    previousOutcome = outcome
    if (outcome.status !== "succeeded") {
      throw new ReaderInputActionSequenceHalt({
        bindingId: binding.id,
        status: outcome.status,
        completedActions,
        action,
        outcome,
      })
    }
    completedActions += 1
    return outcome
  }

  try {
    if (actions.length === 1) await executeAt(actions[0]!, 0)
    else {
      const { default: pMap } = await import("p-map")
      await pMap(actions, executeAt, { concurrency: 1, stopOnError: true })
    }
  } catch (error) {
    if (error instanceof ReaderInputActionSequenceHalt) return error.result
    const outcome = { status: "failed", error } as const
    return { bindingId: binding.id, status: "failed", completedActions, action: actions[completedActions] ?? binding.action, outcome }
  }

  const action = actions.at(-1) ?? binding.action
  return { bindingId: binding.id, status: "succeeded", completedActions, action, outcome: previousOutcome ?? { status: "succeeded" } }
}

/** Coalesces repeats only while a multi-action binding is still running. */
export class ReaderInputActionSequenceRunner {
  readonly #inFlight = new Map<string, Promise<ReaderInputActionSequenceResult>>()

  run(binding: ReaderInputBinding, execute: ReaderInputActionOperation): Promise<ReaderInputActionSequenceResult> {
    if (!binding.followUpActions?.length) return executeReaderInputActionSequence(binding, execute)
    const current = this.#inFlight.get(binding.id)
    if (current) return current
    const running = executeReaderInputActionSequence(binding, execute)
    this.#inFlight.set(binding.id, running)
    void running.finally(() => {
      if (this.#inFlight.get(binding.id) === running) this.#inFlight.delete(binding.id)
    })
    return running
  }
}
