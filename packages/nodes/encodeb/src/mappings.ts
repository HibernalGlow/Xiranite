/**
 * Encodeb's repair mappings: the builder, its fallback transcoder and the order the rename pass applies them.
 *
 * These used to live only in `core.ts`, which forced `platform.ts` — the machine half that walks the tree and
 * renames — to value-import `./core.js` for `createEncodebMappings` and `sortReplaceMappings`. `cli.ts` loads
 * `platform.ts`, so that edge evaluated the node's whole business module inside the face process, i.e. a second
 * execution host for the same core (ADR-0074 §5). `runEncodeb` builds preview mappings too, so the builder is not
 * face-side orchestration that could simply leave core: the implementation sits here, `core.ts` imports it and
 * forwards the same names, and the QuickJS bundle plus every existing `./core.js` consumer still resolve exactly
 * one definition. Same shape as enginev's `filter.ts` and cleanf's `ordering.ts`.
 *
 * `defaultTranscodeName` moved with them because it is a **value** here — the fallback for the `transcodeName`
 * parameter — and an outlet that reached back into `core.js` for it would put the engine one runtime edge away
 * again. Pure data work only: no filesystem, no chardet, no iconv (those stay in `platform.ts`).
 */
import type { EncodebEntry, EncodebInput, EncodebMapping, NameTranscoder } from "./core.js"

export function defaultTranscodeName(name: string): string {
  return name
}

export function createEncodebMappings(
  entries: EncodebEntry[],
  input: Pick<Required<EncodebInput>, "srcEncoding" | "dstEncoding" | "transform" | "limit">,
  transcodeName: NameTranscoder = defaultTranscodeName,
  options: { changedOnly?: boolean; destRoot?: string } = {},
): EncodebMapping[] {
  const changedOnly = options.changedOnly ?? true
  const mappings: EncodebMapping[] = []

  for (const entry of entries) {
    const newParts = entry.relativeParts.map((part) => transcodeName(part, input.srcEncoding, input.dstEncoding, input.transform))
    const changed = newParts.join("\0") !== entry.relativeParts.join("\0")
    if (changedOnly && !changed) continue

    mappings.push({
      src: entry.path,
      dst: joinPath(options.destRoot ?? entry.rootPath, newParts, entry.separator),
      type: entry.type,
      depth: entry.depth,
    })

    if (changedOnly && mappings.length >= input.limit) break
  }

  return mappings
}

/** Deepest entry first, then the longest source: a directory must not be renamed before the files under it. */
export function sortReplaceMappings(mappings: EncodebMapping[]): EncodebMapping[] {
  return [...mappings].sort((a, b) => b.depth - a.depth || b.src.length - a.src.length)
}

function joinPath(root: string, parts: string[], separator = root.includes("\\") ? "\\" : "/"): string {
  const trimmedRoot = root.replace(/[\\/]+$/, "")
  return [trimmedRoot, ...parts].filter(Boolean).join(separator)
}
