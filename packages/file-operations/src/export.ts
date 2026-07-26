import { stringify } from "csv-stringify/sync"

import type { FileDeletionExport, FileDeletionExportFormat, FileDeletionRecord } from "./types.js"

export function exportFileDeletions(
  records: readonly FileDeletionRecord[],
  format: FileDeletionExportFormat,
  exportedAt = Date.now(),
): FileDeletionExport {
  if (format === "jsonl") {
    return {
      format,
      contentType: "application/x-ndjson; charset=utf-8",
      extension: "jsonl",
      content: records.map((record) => JSON.stringify({ schemaVersion: 1, exportedAt, ...record })).join("\n") + (records.length ? "\n" : ""),
      recordCount: records.length,
    }
  }
  if (format === "csv") {
    return {
      format,
      contentType: "text/csv; charset=utf-8",
      extension: "csv",
      content: stringify(records.map(flattenRecord), { header: true, bom: true }),
      recordCount: records.length,
    }
  }
  return {
    format,
    contentType: "text/markdown; charset=utf-8",
    extension: "md",
    content: markdownExport(records, exportedAt),
    recordCount: records.length,
  }
}

function flattenRecord(record: FileDeletionRecord): Record<string, string | number | boolean> {
  return {
    id: record.id,
    transactionId: record.transactionId ?? "",
    transactionIndex: record.transactionIndex ?? "",
    nodeId: record.nodeId,
    componentId: record.componentId ?? "",
    workspaceId: record.workspaceId ?? "",
    sourcePath: record.sourcePath,
    deletionKind: record.deletionKind,
    pathKind: record.pathKind ?? "",
    size: record.size ?? "",
    deletedAt: record.deletedAt,
    deletedAtIso: new Date(record.deletedAt).toISOString(),
    state: record.state,
    restoreAvailable: record.restoreAvailable,
    restoredAt: record.restoredAt ?? "",
    lastRestoreAttemptAt: record.lastRestoreAttemptAt ?? "",
    lastError: record.lastError ?? "",
    trashProvider: record.receipt?.providerData?.kind ?? "",
    trashItemId: record.receipt?.providerData?.kind === "trash-rs" ? record.receipt.providerData.item.id : "",
  }
}

function markdownExport(records: readonly FileDeletionRecord[], exportedAt: number): string {
  const byNode = new Map<string, number>()
  for (const record of records) byNode.set(record.nodeId, (byNode.get(record.nodeId) ?? 0) + 1)
  const summary = [...byNode].sort(([left], [right]) => left.localeCompare(right))
    .map(([nodeId, count]) => `- ${nodeId}: ${count}`)
    .join("\n")
  const rows = records.map((record) => [
    new Date(record.deletedAt).toISOString(),
    record.nodeId,
    record.deletionKind,
    record.state,
    record.restoreAvailable ? "yes" : "no",
    record.sourcePath,
  ].map(markdownCell).join(" | "))
  return [
    "# Xiranite File Deletion History",
    "",
    `Exported: ${new Date(exportedAt).toISOString()}`,
    `Records: ${records.length}`,
    "",
    "## By Node",
    "",
    summary || "- No records",
    "",
    "## Records",
    "",
    "Deleted At | Node | Kind | State | Restore | Full Path",
    "--- | --- | --- | --- | --- | ---",
    ...rows,
    "",
  ].join("\n")
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ")
}
