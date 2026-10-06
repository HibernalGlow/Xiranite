/**
 * MarkU's module vocabulary: the one list of module ids and their display names.
 *
 * It lives here rather than in `core.ts` because three faces read it as a **value** (the `--module` flag text,
 * the guided picker, the module validation, and the GUI's module toolbox). A value import of `core.ts` evaluates
 * the whole engine module in the face process, which is the second execution host ADR-0074 §5 refuses; a module
 * with no imports at all is the seam. `core.ts` re-exports both names, so `@xiranite/node-marku/core` still
 * answers with exactly what it did before.
 */

export type MarkuModuleId =
  | "markt"
  | "consecutive_header"
  | "content_dedup"
  | "html2sy_table"
  | "title_convert"
  | "content_replace"
  | "single_orderlist_remover"
  | "image_path_replacer"
  | "t2list"

export const MARKU_MODULES: Array<{ id: MarkuModuleId; name: string }> = [
  { id: "markt", name: "Heading/list converter" },
  { id: "consecutive_header", name: "Consecutive heading cleanup" },
  { id: "content_dedup", name: "Content deduplication" },
  { id: "html2sy_table", name: "HTML table to Markdown" },
  { id: "title_convert", name: "Title normalization" },
  { id: "content_replace", name: "Content replacement" },
  { id: "single_orderlist_remover", name: "Single ordered-list remover" },
  { id: "image_path_replacer", name: "Image path replacer" },
  { id: "t2list", name: "Table to list" },
]
