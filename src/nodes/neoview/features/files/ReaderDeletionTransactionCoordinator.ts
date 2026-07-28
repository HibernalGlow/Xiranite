import { createStore } from "@xstate/store"
import PQueue from "p-queue"

import type { ReaderInputAction, ReaderInputActionOutcome } from "@xiranite/node-neoview/ui-core"
import type { ReaderActivationIdentityDto, ReaderFileUndoResultDto } from "../../adapters/reader-http-client"

export type ReaderDeletionStrategy = "trash" | "delete"
export type ReaderDeletionTrigger = "reader-input" | "file-card-command"
export type ReaderDeletionTransactionPhase =
  | "idle"
  | "confirming"
  | "preparing"
  | "mutating"
  | "committing"
  | "undoing"
  | "rolling-back"
  | "succeeded"
  | "cancelled"
  | "failed"

export interface ReaderDeletionSessionSnapshot {
  sessionId: string
  activationIdentity: ReaderActivationIdentityDto
}

export interface ReaderDeletionCommand {
  trigger: ReaderDeletionTrigger
  targetPath: string
  strategy: ReaderDeletionStrategy
  confirmationRequired: boolean
  adjacentDirection?: "next" | "previous"
  activeSession?: ReaderDeletionSessionSnapshot
}

export interface ReaderDeletionPreparation {
  releasedSession: boolean
  replacementSessionId?: string
  consumedAction?: ReaderInputAction
}

export interface ReaderDeletionTransactionPorts {
  started?(): void
  settled?(): void
  confirm(command: Readonly<ReaderDeletionCommand>): Promise<boolean>
  prepare(command: Readonly<ReaderDeletionCommand>, signal: AbortSignal): Promise<ReaderDeletionPreparation>
  mutate(command: Readonly<ReaderDeletionCommand>, signal: AbortSignal): Promise<void>
  commit(command: Readonly<ReaderDeletionCommand>, preparation: ReaderDeletionPreparation): void | Promise<void>
  rollback(command: Readonly<ReaderDeletionCommand>, preparation: ReaderDeletionPreparation): void | Promise<void>
}

export interface ReaderDeletionUndoPorts {
  started?(): void
  settled?(): void
  undo(signal: AbortSignal): Promise<ReaderFileUndoResultDto>
  commit(result: ReaderFileUndoResultDto): void | Promise<void>
}

export interface ReaderDeletionTransactionSnapshot {
  phase: ReaderDeletionTransactionPhase
  transactionId?: number
  kind?: "delete" | "undo"
  targetPath?: string
  error?: unknown
}

/** Serializes destructive commands while Xiranite retains Reader-specific lifecycle semantics. */
export class ReaderDeletionTransactionCoordinator {
  readonly #queue = new PQueue({ concurrency: 1 })
  readonly #store = createTransactionStore()
  #transactionId = 0

  getSnapshot(): ReaderDeletionTransactionSnapshot {
    return this.#store.getSnapshot().context
  }

  subscribe(listener: () => void): () => void {
    const subscription = this.#store.subscribe(listener)
    return () => subscription.unsubscribe()
  }

  onIdle(): Promise<void> {
    return this.#queue.onIdle()
  }

  delete(
    command: ReaderDeletionCommand,
    ports: ReaderDeletionTransactionPorts,
  ): Promise<ReaderInputActionOutcome> {
    const captured = captureDeletionCommand(command)
    const transactionId = ++this.#transactionId
    return this.#queue.add(() => this.#delete(transactionId, captured, ports)) as Promise<ReaderInputActionOutcome>
  }

  undo(ports: ReaderDeletionUndoPorts): Promise<ReaderFileUndoResultDto> {
    const transactionId = ++this.#transactionId
    return this.#queue.add(() => this.#undo(transactionId, ports)) as Promise<ReaderFileUndoResultDto>
  }

  async #delete(
    transactionId: number,
    command: Readonly<ReaderDeletionCommand>,
    ports: ReaderDeletionTransactionPorts,
  ): Promise<ReaderInputActionOutcome> {
    const controller = new AbortController()
    let preparation: ReaderDeletionPreparation | undefined
    let mutated = false
    ports.started?.()
    try {
      this.#transition({ phase: "confirming", transactionId, kind: "delete", targetPath: command.targetPath })
      if (!await ports.confirm(command)) {
        this.#transition({ phase: "cancelled", transactionId, kind: "delete", targetPath: command.targetPath })
        return { status: "cancelled" }
      }
      this.#transition({ phase: "preparing", transactionId, kind: "delete", targetPath: command.targetPath })
      preparation = await ports.prepare(command, controller.signal)
      this.#transition({ phase: "mutating", transactionId, kind: "delete", targetPath: command.targetPath })
      await ports.mutate(command, controller.signal)
      mutated = true
      this.#transition({ phase: "committing", transactionId, kind: "delete", targetPath: command.targetPath })
      await ports.commit(command, preparation)
      this.#transition({ phase: "succeeded", transactionId, kind: "delete", targetPath: command.targetPath })
      return {
        status: "succeeded",
        ...(preparation.consumedAction ? { consumedAction: preparation.consumedAction } : {}),
      }
    } catch (error) {
      const cancelled = isAbortError(error)
      if (!mutated && preparation) {
        this.#transition({ phase: "rolling-back", transactionId, kind: "delete", targetPath: command.targetPath, error })
        try {
          await ports.rollback(command, preparation)
        } catch {
          // The mutation error remains authoritative; rollback is best-effort recovery.
        }
      }
      this.#transition({ phase: cancelled ? "cancelled" : "failed", transactionId, kind: "delete", targetPath: command.targetPath, error })
      return cancelled ? { status: "cancelled" } : { status: "failed", error }
    } finally {
      ports.settled?.()
    }
  }

  async #undo(transactionId: number, ports: ReaderDeletionUndoPorts): Promise<ReaderFileUndoResultDto> {
    const controller = new AbortController()
    ports.started?.()
    try {
      this.#transition({ phase: "undoing", transactionId, kind: "undo" })
      const result = await ports.undo(controller.signal)
      await ports.commit(result)
      if (result.failed > 0) throw new Error(`Undo completed with ${result.failed} failed operation(s).`)
      this.#transition({ phase: "succeeded", transactionId, kind: "undo" })
      return result
    } catch (error) {
      this.#transition({ phase: "failed", transactionId, kind: "undo", error })
      throw error
    } finally {
      ports.settled?.()
    }
  }

  #transition(snapshot: ReaderDeletionTransactionSnapshot): void {
    this.#store.trigger.transition(snapshot)
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError"
}

function createTransactionStore() {
  return createStore({
    context: { phase: "idle" } as ReaderDeletionTransactionSnapshot,
    on: {
      transition: (
        _context,
        event: Omit<ReaderDeletionTransactionSnapshot, "phase"> & { phase: ReaderDeletionTransactionPhase },
      ) => ({ ...event }),
    },
  })
}

function captureDeletionCommand(command: ReaderDeletionCommand): Readonly<ReaderDeletionCommand> {
  const targetPath = command.targetPath.trim()
  if (!targetPath) throw new TypeError("Reader deletion targetPath must be a non-empty string.")
  const activeSession = command.activeSession
    ? Object.freeze({
        sessionId: command.activeSession.sessionId,
        activationIdentity: Object.freeze({
          ...command.activeSession.activationIdentity,
          ...(command.activeSession.activationIdentity.traversalFrames?.length
            ? {
                traversalFrames: Object.freeze(command.activeSession.activationIdentity.traversalFrames.map(
                  (frame) => Object.freeze({ ...frame }),
                )),
              }
            : {}),
        }),
      })
    : undefined
  return Object.freeze({
    trigger: command.trigger,
    targetPath,
    strategy: command.strategy,
    confirmationRequired: command.confirmationRequired,
    ...(command.adjacentDirection ? { adjacentDirection: command.adjacentDirection } : {}),
    ...(activeSession ? { activeSession } : {}),
  })
}
