import { describe, expect, it, vi } from "vitest"

import {
  ReaderDeletionTransactionCoordinator,
  type ReaderDeletionCommand,
  type ReaderDeletionTransactionPorts,
} from "./ReaderDeletionTransactionCoordinator"

describe("ReaderDeletionTransactionCoordinator", () => {
  it("captures an immutable target before adjacent-session preparation", async () => {
    const coordinator = new ReaderDeletionTransactionCoordinator()
    const command = deletionCommand("D:/books/A")
    const seen: string[] = []
    const ports = deletionPorts({
      prepare: async (captured) => {
        seen.push(captured.targetPath)
        command.targetPath = "D:/books/B"
        return { releasedSession: true, replacementSessionId: "reader-b", consumedAction: "reader.next-book" }
      },
      mutate: async (captured) => { seen.push(captured.targetPath) },
    })

    await expect(coordinator.delete(command, ports)).resolves.toEqual({
      status: "succeeded",
      consumedAction: "reader.next-book",
    })
    expect(seen).toEqual(["D:/books/A", "D:/books/A"])
  })

  it("deeply captures traversal frames for failure recovery", async () => {
    const coordinator = new ReaderDeletionTransactionCoordinator()
    const command = deletionCommand("D:/books/series/Book 1")
    const frame = { directoryPath: "D:/books/series", currentEntryPath: "D:/books/series/Book 1" }
    command.activeSession = {
      sessionId: "reader-a",
      activationIdentity: {
        readerSourcePath: "D:/books/series/Book 1",
        activatedEntryPath: "D:/books/series/Book 1",
        traversalRootPath: "D:/books",
        traversalFrames: [
          { directoryPath: "D:/books", currentEntryPath: "D:/books/series" },
          frame,
        ],
      },
    }
    let capturedEntry = ""

    await coordinator.delete(command, deletionPorts({
      prepare: async (captured) => {
        frame.currentEntryPath = "D:/books/series/Book 2"
        capturedEntry = captured.activeSession?.activationIdentity.traversalFrames?.at(-1)?.currentEntryPath ?? ""
        return { releasedSession: false }
      },
    }))

    expect(capturedEntry).toBe("D:/books/series/Book 1")
  })

  it("serializes competing deletion commands with p-queue", async () => {
    const coordinator = new ReaderDeletionTransactionCoordinator()
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const ports = deletionPorts({
      mutate: async (command) => {
        order.push(`start:${command.targetPath}`)
        if (command.targetPath.endsWith("A")) await firstGate
        order.push(`end:${command.targetPath}`)
      },
    })

    const first = coordinator.delete(deletionCommand("D:/books/A"), ports)
    const second = coordinator.delete(deletionCommand("D:/books/B"), ports)
    await vi.waitFor(() => expect(order).toEqual(["start:D:/books/A"]))
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual([
      "start:D:/books/A",
      "end:D:/books/A",
      "start:D:/books/B",
      "end:D:/books/B",
    ])
  })

  it("rolls back a prepared Reader session when mutation fails", async () => {
    const coordinator = new ReaderDeletionTransactionCoordinator()
    const rollback = vi.fn()
    const failure = new Error("delete failed")
    const ports = deletionPorts({
      prepare: async () => ({ releasedSession: true, replacementSessionId: "reader-b" }),
      mutate: async () => { throw failure },
      rollback,
    })

    await expect(coordinator.delete(deletionCommand("D:/books/A"), ports)).resolves.toEqual({ status: "failed", error: failure })
    expect(rollback).toHaveBeenCalledOnce()
    expect(coordinator.getSnapshot()).toMatchObject({ phase: "failed", kind: "delete", targetPath: "D:/books/A" })
  })

  it("queues undo behind an active deletion and commits its shared journal result", async () => {
    const coordinator = new ReaderDeletionTransactionCoordinator()
    const order: string[] = []
    const deleted = coordinator.delete(deletionCommand("D:/books/A"), deletionPorts({
      mutate: async () => { order.push("delete") },
    }))
    const undone = coordinator.undo({
      undo: async () => {
        order.push("undo")
        return { results: [], succeeded: 1, failed: 0, remaining: 0 }
      },
      commit: async () => { order.push("commit-undo") },
    })

    await Promise.all([deleted, undone])
    expect(order).toEqual(["delete", "undo", "commit-undo"])
  })

  it("commits successful partial undo results before reporting the failed operations", async () => {
    const coordinator = new ReaderDeletionTransactionCoordinator()
    const partial = { results: [], succeeded: 1, failed: 1, remaining: 1 }
    const commit = vi.fn()

    await expect(coordinator.undo({
      undo: async () => partial,
      commit,
    })).rejects.toThrow("Undo completed with 1 failed operation(s).")

    expect(commit).toHaveBeenCalledWith(partial)
    expect(coordinator.getSnapshot()).toMatchObject({ phase: "failed", kind: "undo" })
  })

  it("settles its lifecycle when confirmation cancels before preparation", async () => {
    const coordinator = new ReaderDeletionTransactionCoordinator()
    const started = vi.fn()
    const settled = vi.fn()
    const prepare = vi.fn()

    await expect(coordinator.delete(deletionCommand("D:/books/A"), deletionPorts({
      started,
      settled,
      confirm: async () => false,
      prepare,
    }))).resolves.toEqual({ status: "cancelled" })

    expect(started).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
    expect(prepare).not.toHaveBeenCalled()
    expect(coordinator.getSnapshot()).toMatchObject({ phase: "cancelled", targetPath: "D:/books/A" })
  })
})

function deletionCommand(targetPath: string): ReaderDeletionCommand {
  return {
    trigger: "reader-input",
    targetPath,
    strategy: "trash",
    confirmationRequired: false,
  }
}

function deletionPorts(
  overrides: Partial<ReaderDeletionTransactionPorts> = {},
): ReaderDeletionTransactionPorts {
  return {
    confirm: async () => true,
    prepare: async () => ({ releasedSession: false }),
    mutate: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    ...overrides,
  }
}
