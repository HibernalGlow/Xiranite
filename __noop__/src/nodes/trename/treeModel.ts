import type { TrenameJson, TrenameNode } from "@xiranite/node-trename/core"
import { parseRenameJson } from "@xiranite/node-trename/core"
import type { TreeViewElement } from "@/components/ui/file-tree"

export interface TrenameTreeModel {
  elements: TreeViewElement[]
  expandedItems: string[]
  parseError: string
  total: number
  pending: number
  ready: number
}

export function buildTreeModel(jsonText: string): TrenameTreeModel {
  if (!jsonText.trim()) return emptyModel("")

  try {
    const parsed = parseRenameJson(jsonText)
    const elements = parsed.root.map((node, index) => toTreeElement(node, `root:${index}`))
    return {
      elements,
      expandedItems: collectExpanded(parsed).slice(0, 32),
      parseError: "",
      ...countTree(parsed),
    }
  } catch (error) {
    return emptyModel(error instanceof Error ? error.message : String(error))
  }
}

function emptyModel(parseError: string): TrenameTreeModel {
  return {
    elements: [],
    expandedItems: [],
    parseError,
    total: 0,
    pending: 0,
    ready: 0,
  }
}

function toTreeElement(node: TrenameNode, id: string): TreeViewElement {
  if ("src" in node) {
    return {
      id,
      name: labelForNode(node.src, node.tgt, false),
      type: "file",
      isSelectable: true,
    }
  }

  return {
    id,
    name: labelForNode(node.src_dir, node.tgt_dir, true),
    type: "folder",
    isSelectable: true,
    children: node.children.map((child, index) => toTreeElement(child, `${id}/${index}`)),
  }
}

function collectExpanded(renameJson: TrenameJson): string[] {
  const ids: string[] = []
  function walk(node: TrenameNode, id: string) {
    if ("children" in node) {
      ids.push(id)
      node.children.forEach((child, index) => walk(child, `${id}/${index}`))
    }
  }
  renameJson.root.forEach((node, index) => walk(node, `root:${index}`))
  return ids
}

function countTree(renameJson: TrenameJson): Pick<TrenameTreeModel, "total" | "pending" | "ready"> {
  const counts = { total: 0, pending: 0, ready: 0 }
  function walk(node: TrenameNode) {
    counts.total += 1
    if ("src" in node) {
      applyStatus(counts, node.src, node.tgt)
      return
    }
    applyStatus(counts, node.src_dir, node.tgt_dir)
    node.children.forEach(walk)
  }
  renameJson.root.forEach(walk)
  return counts
}

function applyStatus(counts: { pending: number; ready: number }, source: string, target?: string) {
  const next = target?.trim() ?? ""
  if (!next) counts.pending += 1
  else if (next !== source) counts.ready += 1
}

function labelForNode(source: string, target: string | undefined, isDir: boolean): string {
  const suffix = isDir ? "/" : ""
  if (!target?.trim()) return `${source}${suffix} · 待翻译`
  if (target === source) return `${source}${suffix} · 不改名`
  return `${source}${suffix} -> ${target}${suffix}`
}
