import { z } from "zod"

import type { FileDeletionRecord, FileUndoJournalRecord, FileUndoReceipt } from "./types.js"

const AbsolutePathLikeSchema = z.string().min(1).refine((value) => !value.includes("\0"), "Path contains a null byte.")
const MutationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["copy", "move", "rename"]),
    sourcePath: AbsolutePathLikeSchema,
    destinationPath: AbsolutePathLikeSchema,
    overwrite: z.boolean().optional(),
  }).strict(),
  z.object({ kind: z.enum(["delete", "trash"]), sourcePath: AbsolutePathLikeSchema }).strict(),
  z.object({ kind: z.literal("create-directory"), destinationPath: AbsolutePathLikeSchema }).strict(),
])
const GuardSchema = z.object({
  path: AbsolutePathLikeSchema,
  kind: z.enum(["file", "directory", "symbolic-link", "other"]),
  size: z.number().nonnegative(),
  mtimeMs: z.number(),
  ctimeMs: z.number(),
  device: z.number(),
  inode: z.number(),
}).strict()
const RustTrashReceiptSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  originalParent: AbsolutePathLikeSchema,
  timeDeleted: z.number(),
}).strict()
const UndoReceiptSchema = z.object({
  original: MutationSchema,
  inverse: MutationSchema,
  guard: GuardSchema,
  providerData: z.union([
    z.object({ kind: z.literal("trash-rs"), item: RustTrashReceiptSchema }).strict(),
    z.object({ kind: z.literal("windows-recycle-bin"), itemPath: z.string().min(1) }).strict(),
  ]).optional(),
}).strict()
const UndoJournalRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number().nonnegative(),
  entries: z.array(z.object({
    index: z.number().int().nonnegative(),
    receipt: UndoReceiptSchema,
    deletionId: z.string().min(1).optional(),
  }).strict()),
}).strict()
const DeletionRecordSchema = z.object({
  id: z.string().min(1),
  transactionId: z.string().min(1).optional(),
  transactionIndex: z.number().int().nonnegative().optional(),
  nodeId: z.string().min(1),
  componentId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  sourcePath: AbsolutePathLikeSchema,
  deletionKind: z.enum(["trash", "delete"]),
  pathKind: z.enum(["file", "directory", "symbolic-link", "other"]).optional(),
  size: z.number().nonnegative().optional(),
  deletedAt: z.number().nonnegative(),
  state: z.enum(["pending", "trashed", "restored", "restore-failed", "permanent", "delete-failed"]),
  restoreAvailable: z.boolean(),
  receipt: UndoReceiptSchema.optional(),
  restoredAt: z.number().nonnegative().optional(),
  lastRestoreAttemptAt: z.number().nonnegative().optional(),
  lastError: z.string().optional(),
}).strict()

export function parseFileUndoReceipt(value: unknown): FileUndoReceipt {
  return UndoReceiptSchema.parse(value) as FileUndoReceipt
}

export function parseFileUndoJournalRecord(value: unknown): FileUndoJournalRecord {
  return UndoJournalRecordSchema.parse(value) as FileUndoJournalRecord
}

export function parseFileDeletionRecord(value: unknown): FileDeletionRecord {
  return DeletionRecordSchema.parse(value) as FileDeletionRecord
}
