import { RULE_TREE_FORMAT, type RuleTree } from "@xiranite/shared/rules"
import type { FindzTask } from "@xiranite/findz-native"
import type { RuleTreeField } from "@/nodes/shared/RuleTreeEditor"

export type FindzAreaMetric = "archiveSize" | "totalImageSize" | "averageImageSize" | "averageBytesPerMegapixel" | "anomalyCount" | "estimatedSavings"
export type FindzArchiveSort = "relativePath" | "archiveSize" | "imageCount" | "analysisCoverage" | "totalImageSize" | "averageImageSize" | "averageBytesPerMegapixel" | "anomalyCount" | "estimatedSavings"

export interface FindzCardState {
  libraryRoot?: string
  libraryId?: string
  pathPrefix?: string
  text?: string
  rules?: RuleTree
  sortBy?: FindzArchiveSort
  sortDesc?: boolean
  areaBy?: FindzAreaMetric
  selectedArchiveId?: number
  taskId?: string
}

export const FINDZ_RULE_FIELDS: readonly RuleTreeField[] = [
  { name: "relativePath", label: "Archive path", type: "text" },
  { name: "scanState", label: "Index state", type: "select", options: [{ name: "indexed", label: "Indexed" }, { name: "corrupt_archive", label: "Corrupt" }, { name: "unsupported_archive", label: "Unsupported" }] },
  { name: "archiveSize", label: "Archive size", type: "number" },
  { name: "memberCount", label: "Members", type: "number" },
  { name: "imageCount", label: "Image candidates", type: "number" },
  { name: "analysisCoverage", label: "Analyzed images", type: "number" },
  { name: "totalImageSize", label: "Total image size", type: "number" },
  { name: "averageBytesPerMegapixel", label: "Average bytes / MP", type: "number" },
  { name: "anomalyCount", label: "Anomalies", type: "number" },
  { name: "estimatedSavings", label: "Estimated savings", type: "number" },
]

export const FINDZ_AREA_METRICS: ReadonlyArray<{ value: FindzAreaMetric; label: string }> = [
  { value: "archiveSize", label: "Archive size" },
  { value: "totalImageSize", label: "Total image size" },
  { value: "averageImageSize", label: "Average image size" },
  { value: "averageBytesPerMegapixel", label: "Average bytes / MP" },
  { value: "anomalyCount", label: "Anomaly count" },
  { value: "estimatedSavings", label: "Estimated savings" },
]

export const FINDZ_ARCHIVE_SORTS: ReadonlyArray<{ value: FindzArchiveSort; label: string }> = [
  { value: "relativePath", label: "Path" },
  { value: "archiveSize", label: "Archive size" },
  { value: "imageCount", label: "Image candidates" },
  { value: "analysisCoverage", label: "Analysis coverage" },
  { value: "totalImageSize", label: "Total image size" },
  { value: "averageImageSize", label: "Average image size" },
  { value: "averageBytesPerMegapixel", label: "Average bytes / MP" },
  { value: "anomalyCount", label: "Anomalies" },
  { value: "estimatedSavings", label: "Estimated savings" },
]

export function createFindzRuleTree(): RuleTree {
  return {
    format: RULE_TREE_FORMAT,
    version: 1,
    root: { id: "findz-root", kind: "group", combinator: "all", not: false, children: [] },
  }
}

export function isTerminalTask(task: FindzTask | undefined): boolean {
  return task !== undefined && ["completed", "completed_with_warnings", "cancelled", "failed"].includes(task.status)
}
