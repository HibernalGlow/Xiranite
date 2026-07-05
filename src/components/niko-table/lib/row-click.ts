/**
 * niko-table — created by Semir N. (Semkoo, https://github.com/Semkoo) with AI assistance.
 *
 * Shared row-click guard. Centralized so the interactive-element list
 * stays in sync across all body variants.
 *
 * Copied from upstream src/components/niko-table/lib/row-click.ts
 */
import type { Table } from "@tanstack/react-table"

export function isInteractiveClickTarget(target: HTMLElement): boolean {
  const selection =
    typeof window !== "undefined" ? window.getSelection?.() : null
  if (selection && !selection.isCollapsed && selection.toString().length > 0) {
    return true
  }

  return Boolean(
    target.closest("button") ||
      target.closest("input") ||
      target.closest("textarea") ||
      target.closest("select") ||
      target.closest("a") ||
      target.closest("label") ||
      target.closest("[contenteditable]") ||
      target.closest('[role="button"]') ||
      target.closest('[role="checkbox"]') ||
      target.closest('[role="combobox"]') ||
      target.closest('[role="menuitem"]') ||
      target.closest('[role="textbox"]') ||
      target.closest("[data-radix-collection-item]") ||
      target.closest('[data-slot="checkbox"]') ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.tagName === "BUTTON" ||
      target.tagName === "A",
  )
}

export function resolveRowFromClick<TData>(
  target: HTMLElement,
  table: Table<TData>,
) {
  if (isInteractiveClickTarget(target)) return null
  const rowEl = target.closest("tr[data-row-id]")
  if (!rowEl) return null
  const rowId = rowEl.getAttribute("data-row-id")
  if (rowId === null) return null
  return table.getRow(rowId) ?? null
}
