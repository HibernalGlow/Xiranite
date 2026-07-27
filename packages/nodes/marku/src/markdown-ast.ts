import { remark } from "remark"
import type { Root } from "mdast"

export type MarkuMarkdownBlockKind = "heading" | "image" | "paragraph"

export interface MarkuMarkdownBlock {
  kind: MarkuMarkdownBlockKind
  start: number
  end: number
  source: string
}

export interface MarkuMarkdownEdit {
  start: number
  end: number
  replacement: string
}

interface MarkdownNode {
  type: string
  position?: { start: { offset?: number }; end: { offset?: number } }
  children?: MarkdownNode[]
}

/**
 * Marku applies source-range patches instead of serializing mdast, preserving
 * the user's untouched Markdown formatting while respecting code boundaries.
 */
export function collectMarkuMarkdownBlocks(source: string): MarkuMarkdownBlock[] {
  const root = remark().parse(source) as unknown as Root as MarkdownNode
  const blocks: MarkuMarkdownBlock[] = []
  visitMarkdownNode(root, (node) => {
    if (node.type === "heading") {
      addBlock(blocks, "heading", source, node)
      return false
    }
    if (node.type === "paragraph") {
      const onlyChild = node.children?.[0]
      if (node.children?.length === 1 && onlyChild?.type === "image") addBlock(blocks, "image", source, node)
      else addBlock(blocks, "paragraph", source, node)
      return false
    }
    return true
  })
  return blocks
}

export function collectMarkuAtxHeadings(source: string): MarkuMarkdownBlock[] {
  return collectMarkuMarkdownBlocks(source).filter((block) => block.kind === "heading" && /^ {0,3}#{1,6}\s+/.test(block.source))
}

export function collectMarkuImages(source: string): MarkuMarkdownBlock[] {
  const root = remark().parse(source) as unknown as Root as MarkdownNode
  const images: MarkuMarkdownBlock[] = []
  visitMarkdownNode(root, (node) => {
    if (node.type === "image") addBlock(images, "image", source, node)
    return true
  })
  return images
}

export function rangeWithTrailingLineBreak(source: string, block: Pick<MarkuMarkdownBlock, "start" | "end">): MarkuMarkdownEdit {
  let end = block.end
  if (source.charCodeAt(end) === 13 && source.charCodeAt(end + 1) === 10) end += 2
  else if (source.charCodeAt(end) === 10) end += 1
  return { start: block.start, end, replacement: "" }
}

export function applyMarkuMarkdownEdits(source: string, edits: readonly MarkuMarkdownEdit[]): string {
  const ordered = [...edits].sort((left, right) => left.start - right.start || left.end - right.end)
  let previousEnd = 0
  for (const edit of ordered) {
    if (edit.start < previousEnd || edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
      throw new Error("Markdown edit ranges must be ordered, non-overlapping, and in bounds.")
    }
    previousEnd = edit.end
  }
  return [...ordered].reverse().reduce((output, edit) => `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`, source)
}

function visitMarkdownNode(node: MarkdownNode, visit: (node: MarkdownNode) => boolean): void {
  if (!visit(node)) return
  for (const child of node.children ?? []) visitMarkdownNode(child, visit)
}

function addBlock(blocks: MarkuMarkdownBlock[], kind: MarkuMarkdownBlockKind, source: string, node: MarkdownNode): void {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return
  const value = source.slice(start, end)
  if (!value.trim()) return
  blocks.push({ kind, start, end, source: value })
}
