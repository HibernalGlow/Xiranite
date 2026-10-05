import type { InteractionField, InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import type { LinedupFilterInput, LinedupFilterResult } from "./core.js"

/**
 * The face-side input document: what the terminal fields hold and what `definition.run` is called
 * with. `sourceText`/`filterText` stay single text blocks because the multiline widget edits text;
 * the line arrays the host entry takes are produced at the wire edge (`toLinedupWireInput`).
 */
export interface LinedupInput {
  sourceText: string
  filterText: string
  caseSensitive: boolean
  sort: boolean
}

/**
 * The result document the host answers with. linedup's only host entry is `filterLines`
 * (`crates/xiranite-scripted-nodes/src/registration.rs`, a `JsNodeSpec::pure`), and `pure_envelope`
 * (`crates/quickjs-realm/src/engine.rs`) wraps a pure node's return value as
 * `{ success, message, data }` — so `data` is exactly `LinedupFilterResult` and nothing else is
 * answerable over `/nodes/linedup/operations`.
 */
export interface LinedupResult {
  success: boolean
  message: string
  data?: LinedupFilterResult
}

export type LinedupInteractionValues = InteractionValues & LinedupInput

/**
 * Wire encoding, not business logic: one edited text block in, the line array the host entry takes
 * out. Nothing is trimmed, dropped or deduplicated here — `filterLines` normalises, dedupes and
 * matches on the host, and a face that pre-filtered would be a second engine.
 */
export function splitWireLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
}

/** The input document `/nodes/linedup/operations` expects for the `filterLines` entry. */
export function toLinedupWireInput(input: LinedupInput): LinedupFilterInput {
  return {
    sourceLines: splitWireLines(input.sourceText),
    filterLines: splitWireLines(input.filterText),
    caseSensitive: input.caseSensitive,
    sort: input.sort,
  }
}

export function createLinedupInteractionSchema(
  d: Partial<LinedupInteractionValues> = {},
  language: TerminalLanguage = "zh",
): TerminalInteractionSchema<LinedupInput, LinedupResult> {
  const zh = language === "zh"
  const initialValues = { sourceText: "", filterText: "", caseSensitive: true, sort: true, ...clean(d) } as LinedupInteractionValues
  const fields: InteractionField[] = [
    { id: "sourceText", label: zh ? "原文本" : "Source text", kind: "multiline", lines: 10 },
    { id: "filterText", label: zh ? "过滤词" : "Filter tokens", kind: "multiline", lines: 6 },
    { id: "caseSensitive", label: zh ? "区分大小写" : "Case sensitive", kind: "boolean" },
    { id: "sort", label: zh ? "排序输出" : "Sort output", kind: "boolean" },
  ]
  return {
    id: "linedup",
    title: "LinedUp",
    description: zh ? "按过滤词移除文本行并解释命中" : "Remove text lines by filter tokens and explain matches",
    initialValues,
    fields,
    view: {
      sections: [{ id: "filter", title: zh ? "文本过滤" : "Text filter", fieldIds: fields.map((x) => x.id) }],
      dashboard: {
        title: "LinedUp",
        display: (v) => ({
          primary: `${String(v.sourceText ?? "").length} chars`,
          secondary: `${String(v.filterText ?? "").length} filter chars`,
          metrics: [],
        }),
      },
    },
    toInput: (v) => ({
      sourceText: String(v.sourceText ?? ""),
      filterText: String(v.filterText ?? ""),
      caseSensitive: v.caseSensitive !== false,
      sort: v.sort !== false,
    }),
    validate: (_v, i) => (i.sourceText.trim() ? null : zh ? "请输入原文本。" : "Enter source text."),
    preview: (i) => [
      `${splitWireLines(i.sourceText).length} ${zh ? "行" : "line(s)"}`,
      `${splitWireLines(i.filterText).filter(Boolean).length} filters`,
    ],
    isDangerous: () => false,
    result: (r) => ({
      success: r.success,
      message: r.message,
      lines: [`Kept: ${r.data?.keptCount ?? 0}`, `Removed: ${r.data?.removedCount ?? 0}`],
    }),
  }
}

const clean = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined))
