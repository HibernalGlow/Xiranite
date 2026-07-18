import { GitCommitHorizontal } from "lucide-react"

export const NODE_ICON = GitCommitHorizontal

export const STATUS_CODE_MAP: Record<string, { label: string; color: string }> = {
  M: { label: "Modified", color: "text-amber-500" },
  A: { label: "Added", color: "text-green-500" },
  D: { label: "Deleted", color: "text-red-500" },
  R: { label: "Renamed", color: "text-blue-500" },
  C: { label: "Copied", color: "text-purple-500" },
  "?": { label: "Untracked", color: "text-gray-500" },
}
