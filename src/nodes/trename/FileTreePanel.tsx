import { useMemo } from "react"
import type { TrenameDirNode, TrenameJson, TrenameNode } from "@xiranite/node-trename/core"
import { parseRenameJson } from "@xiranite/node-trename/core"
import { FolderOpen, Maximize2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { CollapseButton, Tree, type TreeViewElement } from "@/components/ui/file-tree"
import { Separator } from "@/components/ui/separator"

export interface TrenameTreeModel {
  elements: TreeViewElement[]
  expandedItems: string[]
  parseError: string
  total: number
  pending: number
  ready: number
}

export function FileTreePanel(props: {
  compact?: boolean
  jsonText: string
}) {
  const model = useMemo(() => buildTreeModel(props.jsonText), [props.jsonText])

  if (!model.elements.length) {
    return (
      <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
        <Empty className="h-full min-h-36 border-0 p-4">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle className="text-base">等待 rename JSON</EmptyTitle>
            <EmptyDescription>
              扫描目录或导入 JSON 后，这里会显示目录树、待翻译项和已准备重命名项。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2">
          <FolderOpen className="size-4 text-muted-foreground" />
          <div className="truncate text-xs font-medium">文件树</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="outline">{model.total} 项</Badge>
          <Badge variant={model.ready ? "default" : "secondary"}>{model.ready} 就绪</Badge>
          <Badge variant={model.pending ? "outline" : "secondary"}>{model.pending} 待填</Badge>
        </div>
      </div>
      <Separator />
      <div className="min-h-0 flex-1">
        <Tree
          actions={(
            <CollapseButton elements={model.elements}>
              <Maximize2 data-icon="inline-start" />
              展开
            </CollapseButton>
          )}
          className="text-xs"
          elements={model.elements}
          initialExpandedItems={model.expandedItems}
          sort="none"
        />
      </div>
    </section>
  )
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
      isSelectable: false,
    }
  }

  return {
    id,
    name: labelForNode(node.src_dir, node.tgt_dir, true),
    type: "folder",
    isSelectable: false,
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
