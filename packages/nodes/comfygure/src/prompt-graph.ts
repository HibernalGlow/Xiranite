import type { PromptGraph, PromptInput, PromptLink, PromptNode } from "./contracts.js"
import { isRecord } from "./value-normalization.js"

export function orderedPromptNodes(graph: PromptGraph): Array<[string, PromptNode]> {
  return Object.entries(graph).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
}
export function clonePromptGraph(graph: PromptGraph): PromptGraph {
  return JSON.parse(JSON.stringify(graph)) as PromptGraph
}
export function rewritePromptGraphLinks(graph: PromptGraph, redirects: ReadonlyMap<string, PromptInput>): void {
  for (const node of Object.values(graph)) {
    for (const [inputName, input] of Object.entries(node.inputs)) node.inputs[inputName] = replacePromptInputLinks(input, redirects, new Set())
  }
}
export function replacePromptInputLinks(value: PromptInput, redirects: ReadonlyMap<string, PromptInput>, visited: Set<string>): PromptInput {
  if (isPromptLink(value)) {
    const key = promptOutputKey(value[0], value[1])
    const replacement = redirects.get(key)
    if (replacement === undefined || !visited.add(key)) return value
    return replacePromptInputLinks(replacement, redirects, visited)
  }
  if (Array.isArray(value)) return value.map((item) => replacePromptInputLinks(item, redirects, new Set()))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePromptInputLinks(item, redirects, new Set())]))
  return value
}
export function referencedOutputIndexes(graph: PromptGraph, nodeId: string): Set<number> {
  const indexes = new Set<number>()
  for (const node of Object.values(graph)) {
    for (const input of Object.values(node.inputs)) {
      for (const link of promptLinksIn(input)) if (link[0] === nodeId) indexes.add(link[1])
    }
  }
  return indexes
}
export function* promptLinksIn(value: PromptInput): Generator<PromptLink> {
  if (isPromptLink(value)) {
    yield value
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* promptLinksIn(item)
    return
  }
  if (isRecord(value)) for (const item of Object.values(value)) yield* promptLinksIn(item)
}
export function isPromptLink(value: PromptInput): value is PromptLink {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number"
}
export function promptOutputKey(nodeId: string, outputIndex: number): string {
  return `${nodeId}\u0000${outputIndex}`
}
export function nextPromptGraphNodeId(graph: PromptGraph): number {
  const largest = Object.keys(graph).reduce((value, nodeId) => /^\d+$/.test(nodeId) ? Math.max(value, Number(nodeId)) : value, 0)
  return largest + 1
}
export function promptInputString(value: PromptInput | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}
export function numberPromptInput(value: PromptInput | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
export function integerPromptInput(value: PromptInput | undefined, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(numberPromptInput(value, fallback))))
}
export function booleanPromptInput(value: PromptInput | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") return ["true", "1", "yes", "y", "on", "enable", "enabled"].includes(value.trim().toLocaleLowerCase())
  return fallback
}
