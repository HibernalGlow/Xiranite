import {
  SETTINGS_STAGES,
  type SettingsSectionId,
  type SettingsStepId,
} from "./types"

export const SETTINGS_SECTION_IDS = SETTINGS_STAGES.map((stage) => stage.id) as readonly SettingsSectionId[]

export type SettingsSearchMatch =
  | {
    kind: "stage"
    sectionId: SettingsSectionId
    label: string
  }
  | {
    kind: "step"
    sectionId: SettingsSectionId
    stepId: SettingsStepId
    label: string
    stageLabel: string
  }

/** Normalize URL/query values to a known settings section id, or null. */
export function parseSettingsSectionId(raw: string | null | undefined): SettingsSectionId | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase()
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(normalized)
    ? (normalized as SettingsSectionId)
    : null
}

/**
 * Filter stages and steps by translated labels (and raw ids as secondary keys).
 * Empty / whitespace query returns no matches so the result list stays closed.
 */
export function filterSettingsMatches(
  query: string,
  translate: (key: string) => string,
): SettingsSearchMatch[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const matches: SettingsSearchMatch[] = []

  for (const stage of SETTINGS_STAGES) {
    const stageLabel = translate(stage.labelKey)
    const stageHaystack = [
      stageLabel,
      stage.id,
      translate(stage.descriptionKey),
    ].join(" ").toLowerCase()

    if (stageHaystack.includes(needle)) {
      matches.push({ kind: "stage", sectionId: stage.id, label: stageLabel })
    }

    for (const step of stage.steps) {
      const stepLabel = translate(step.labelKey)
      const stepHaystack = [stepLabel, step.id, stageLabel, stage.id].join(" ").toLowerCase()
      if (stepHaystack.includes(needle)) {
        matches.push({
          kind: "step",
          sectionId: stage.id,
          stepId: step.id,
          label: stepLabel,
          stageLabel,
        })
      }
    }
  }

  return matches
}

/** Scroll the settings content pane to a step card (`data-settings-step`). */
export function scrollToSettingsStep(
  root: ParentNode | null | undefined,
  stepId: SettingsStepId,
  behavior: ScrollBehavior = "smooth",
): boolean {
  if (!root) return false
  const target = root.querySelector<HTMLElement>(`[data-settings-step="${stepId}"]`)
  if (!target) return false
  target.scrollIntoView({ behavior, block: "start" })
  return true
}

/** Scroll the settings content pane to a timeline stage (`data-timeline-entry`). */
export function scrollToSettingsStage(
  root: ParentNode | null | undefined,
  sectionId: SettingsSectionId,
  behavior: ScrollBehavior = "smooth",
): boolean {
  if (!root) return false
  const target = root.querySelector<HTMLElement>(`[data-timeline-entry="${sectionId}"]`)
  if (!target) return false
  target.scrollIntoView({ behavior, block: "start" })
  return true
}

export function scrollToSettingsMatch(
  root: ParentNode | null | undefined,
  match: SettingsSearchMatch,
  behavior: ScrollBehavior = "smooth",
): boolean {
  if (match.kind === "step") return scrollToSettingsStep(root, match.stepId, behavior)
  return scrollToSettingsStage(root, match.sectionId, behavior)
}
