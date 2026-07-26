declare module "webtreemap-cdt/build/index.js" {
  export interface WebTreemapNode {
    id?: string
    size: number
    children?: WebTreemapNode[]
    dom?: HTMLElement
  }

  export function render(container: HTMLElement, node: WebTreemapNode, options?: {
    padding?: [number, number, number, number]
    caption?(node: WebTreemapNode): string
    applyMutations?(node: WebTreemapNode): void
    showNode?(node: WebTreemapNode, width: number, height: number): boolean
    showChildren?(node: WebTreemapNode, width: number, height: number): boolean
  }): void
}
