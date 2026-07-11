import type { InteractionField, InteractionOption, InteractionValue } from "../interaction.js"
import type { TerminalTranslator } from "./i18n.js"

export function optionsForField(field: InteractionField, t: TerminalTranslator): readonly InteractionOption[] {
  if (field.kind === "boolean") {
    return [
      { value: true, label: t("yes") },
      { value: false, label: t("no") },
    ]
  }
  return field.options ?? []
}

export function displayInteractionValue(field: InteractionField, value: InteractionValue | undefined): string {
  const option = field.options?.find((candidate) => candidate.value === value)
  if (option) return option.label
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return value === undefined ? "" : String(value)
}

export function safeConfirmationOptions(t: TerminalTranslator) {
  return [
    { value: "execute", label: t("run"), hint: t("executeHint") },
    { value: "back", label: t("back"), hint: t("editHint") },
  ] as const
}

export function dangerConfirmationOptions(t: TerminalTranslator) {
  return [
    { value: "back", label: t("cancel"), hint: t("editHint") },
    { value: "execute", label: t("runReal"), hint: t("runRealHint") },
  ] as const
}

export function resultOptions(t: TerminalTranslator) {
  return [
    { value: "again", label: t("runAgain") },
    { value: "exit", label: t("exit") },
  ] as const
}
