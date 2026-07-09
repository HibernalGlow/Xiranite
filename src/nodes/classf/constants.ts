import { ArrowRightLeft, ClipboardList, Copy, FolderCheck, FolderInput, FolderSymlink, MoveRight, Play, Workflow } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ClassfAction, ClassfClassifyMode, ClassfTransferMode } from "@xiranite/node-classf/core"

export interface ClassfActionMeta {
  value: ClassfAction
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}

export interface ClassfModeMeta {
  value: ClassfClassifyMode
  label: string
  description: string
  icon: LucideIcon
}

export interface ClassfTransferMeta {
  value: ClassfTransferMode
  label: string
  description: string
  icon: LucideIcon
}

export const ACTIONS: ClassfActionMeta[] = [
  {
    value: "plan",
    label: "Build plan",
    shortLabel: "Plan",
    description: "Preview already, wait, or target transfers.",
    icon: ClipboardList,
  },
  {
    value: "classify",
    label: "Classify items",
    shortLabel: "Classify",
    description: "Apply ready move or copy transfers.",
    icon: Play,
  },
]

export const CLASSIFY_MODES: ClassfModeMeta[] = [
  {
    value: "auto",
    label: "Auto",
    description: "Selected items go to already; remaining siblings go to wait.",
    icon: FolderSymlink,
  },
  {
    value: "only",
    label: "Already only",
    description: "Selected items go to already, without wait candidates.",
    icon: FolderCheck,
  },
  {
    value: "off",
    label: "Target",
    description: "Selected items go to the explicit target folder.",
    icon: FolderInput,
  },
]

export const TRANSFER_MODES: ClassfTransferMeta[] = [
  {
    value: "move",
    label: "Move",
    description: "Move source paths into the planned folders.",
    icon: MoveRight,
  },
  {
    value: "copy",
    label: "Copy",
    description: "Copy source paths and keep originals in place.",
    icon: Copy,
  },
]

export const NODE_ICON = Workflow
export const PLAN_ICON = ArrowRightLeft
