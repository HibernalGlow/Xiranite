import { Archive, CalendarClock, ClipboardList, FileStack, FolderTree, ListChecks, Route, Search } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { SynctAction, SynctFormatKey, SynctSourceMode } from "@xiranite/node-synct/core"

export interface SynctActionMeta {
  value: SynctAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}

export interface SynctSourceModeMeta {
  value: SynctSourceMode
  label: string
  description: string
  icon: LucideIcon
}

export interface SynctFormatMeta {
  value: SynctFormatKey
  label: string
  example: string
  icon: LucideIcon
}

export const ACTIONS: SynctActionMeta[] = [
  {
    value: "scan",
    label: "Scan dates",
    shortLabel: "Scan",
    description: "Read source names and show detected timestamps.",
    icon: Search,
  },
  {
    value: "plan",
    label: "Build plan",
    shortLabel: "Plan",
    description: "Preview target archive paths and conflicts.",
    icon: ClipboardList,
  },
  {
    value: "archive",
    label: "Archive items",
    shortLabel: "Archive",
    description: "Move ready items into date-based folders.",
    icon: Archive,
  },
]

export const SOURCE_MODES: SynctSourceModeMeta[] = [
  {
    value: "files",
    label: "Files",
    description: "Archive files from each source path.",
    icon: FileStack,
  },
  {
    value: "folders",
    label: "Folders",
    description: "Archive direct child folders from each source path.",
    icon: FolderTree,
  },
]

export const FORMAT_OPTIONS: SynctFormatMeta[] = [
  { value: "year_month", label: "Year month", example: "2026-07/file", icon: CalendarClock },
  { value: "year_month_day", label: "Date", example: "2026-07-10/file", icon: CalendarClock },
  { value: "nested_y_m", label: "Year / month", example: "2026/07/file", icon: Route },
  { value: "nested_y_m_d", label: "Year / month / day", example: "2026/07/10/file", icon: Route },
  { value: "nested_ym_d", label: "Month folder + day", example: "2026-07/10/file", icon: Route },
  { value: "nested_y_md", label: "Year + month day", example: "2026/07-10/file", icon: Route },
  { value: "year", label: "Year", example: "2026/file", icon: ListChecks },
  { value: "month_day", label: "Month day", example: "07-10/file", icon: ListChecks },
  { value: "day", label: "Day", example: "10/file", icon: ListChecks },
]

export const NODE_ICON = CalendarClock
