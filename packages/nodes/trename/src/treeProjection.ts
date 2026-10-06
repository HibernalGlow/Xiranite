import type { TrenameJson, TrenameNode } from "./core.js"

/**
 * The terminal face's rename-JSON projection: it reads the *document shape* out of the editor buffer so the
 * directory tree can draw it, and nothing else.
 *
 * Why it lives on the face side (ADR-0074 §5): `cli.ts`/`Tui.tsx` must not value-import the node core,
 * because that would put a second execution host in the face process — `parseRenameJson()` is core's
 * entry, and the tree panel only ever needed its JSON shape. The authoritative read stays in the host's own
 * `core.ts`, which re-parses `jsonContent` on every `import`/`validate`/`rename` action
 * (`packages/nodes/trename/src/core.ts:256`, called from `runImport`/`runValidate`/`runRename`); whatever
 * this projection decides only changes what is drawn, never which files get renamed. The same split already
 * exists for the web face (`src/nodes/trename/treeModel.ts`), and no rename semantics are duplicated here:
 * `sanitizeFilename()`, `fixExtensionPosition()`, `validateRenameJson()`'s conflict verdicts and the undo
 * journal all stay single-sourced in the host.
 *
 * Alignment with the host's normaliser is field-for-field and deliberately narrow: a non-array `root` reads
 * as empty, a node with neither a string `src` nor a string `src_dir` is dropped, `tgt`/`tgt_dir` become
 * text, and a missing `children` is empty (`core.ts:686-703`).
 */
export function readRenameDocument(jsonText: string): TrenameJson {
  const parsed = asRecord(JSON.parse(jsonText) as unknown)
  const root = parsed.root
  return { root: Array.isArray(root) ? root.flatMap(normalizeNode) : [] }
}

/** `flatMap` on purpose: a node the host would drop contributes no row instead of an `undefined` one. */
function normalizeNode(value: unknown): TrenameNode[] {
  const record = asRecord(value)
  if (typeof record.src === "string") {
    return [{ src: record.src, tgt: text(record.tgt) }]
  }
  if (typeof record.src_dir === "string") {
    const children = Array.isArray(record.children) ? record.children.flatMap(normalizeNode) : []
    return [{ src_dir: record.src_dir, tgt_dir: text(record.tgt_dir), children }]
  }
  return []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

/** The host's `stringValue()` reading (`core.ts:823`): absent is empty text, anything else is text. */
function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}
