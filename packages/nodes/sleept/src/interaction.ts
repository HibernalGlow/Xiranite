import type {
  InteractionField,
  InteractionValue,
  InteractionValues,
  TerminalInteractionSchema,
  TerminalLanguage,
} from "@xiranite/cli-runtime"

import {
  countdownSeconds,
  formatDuration,
  parseTargetDatetime,
  type NetTriggerMode,
  type PowerMode,
  type SleeptInput,
  type SleeptResult,
} from "./core.js"
import { createSleeptTranslator } from "./i18n.js"

export type SleeptInteractionAction = "countdown" | "specific_time" | "netspeed" | "cpu" | "get_stats"

export type SleeptInteractionValues = InteractionValues & {
  action: SleeptInteractionAction
  powerMode: PowerMode
  hours: number
  minutes: number
  seconds: number
  targetDatetime: string
  uploadThreshold: number
  downloadThreshold: number
  netDuration: number
  netTriggerMode: NetTriggerMode
  cpuThreshold: number
  cpuDuration: number
  dryrun: boolean
  maxWaitSeconds: number
}

export const defaultSleeptInteractionValues: SleeptInteractionValues = {
  action: "countdown",
  powerMode: "sleep",
  hours: 0,
  minutes: 0,
  seconds: 5,
  targetDatetime: "",
  uploadThreshold: 242,
  downloadThreshold: 242,
  netDuration: 2,
  netTriggerMode: "both",
  cpuThreshold: 10,
  cpuDuration: 2,
  dryrun: true,
  maxWaitSeconds: 3600,
}

export function createSleeptInteractionSchema(
  defaults: Partial<SleeptInteractionValues> = {},
  language: TerminalLanguage = "en",
): TerminalInteractionSchema<SleeptInput, SleeptResult> {
  const t = createSleeptTranslator(language)
  const initialValues: SleeptInteractionValues = { ...defaultSleeptInteractionValues }
  for (const [key, value] of Object.entries(defaults)) {
    if (value !== undefined) initialValues[key] = value
  }
  const forAction = (...actions: SleeptInteractionAction[]) => (values: Readonly<InteractionValues>) => actions.includes(values.action as SleeptInteractionAction)
  const nonNegative = (value: InteractionValue) => validateNumber(value, 0, t("invalidNumber", { min: 0 }))
  const fields: InteractionField[] = [
    {
      id: "action",
      label: t("action"),
      description: t("actionHint"),
      kind: "select",
      options: [
        { value: "countdown", label: t("timerCountdown") },
        { value: "specific_time", label: t("timerAt") },
        { value: "netspeed", label: t("timerNet") },
        { value: "cpu", label: t("timerCpu") },
        { value: "get_stats", label: t("statusAction") },
      ],
    },
    { id: "hours", label: t("hours"), kind: "number", visibleWhen: forAction("countdown"), validate: nonNegative },
    { id: "minutes", label: t("minutes"), kind: "number", visibleWhen: forAction("countdown"), validate: nonNegative },
    { id: "seconds", label: t("seconds"), kind: "number", visibleWhen: forAction("countdown"), validate: nonNegative },
    {
      id: "targetDatetime",
      label: t("targetDatetime"),
      placeholder: "YYYY-MM-DD HH:MM:SS",
      kind: "text",
      visibleWhen: forAction("specific_time"),
      validate: (value) => validateTarget(String(value), t("targetRequired")),
    },
    { id: "uploadThreshold", label: t("uploadThreshold"), kind: "number", visibleWhen: forAction("netspeed"), validate: nonNegative },
    { id: "downloadThreshold", label: t("downloadThreshold"), kind: "number", visibleWhen: forAction("netspeed"), validate: nonNegative },
    { id: "netDuration", label: t("sustainedMinutes"), kind: "number", visibleWhen: forAction("netspeed"), validate: nonNegative },
    {
      id: "netTriggerMode",
      label: t("triggerMode"),
      kind: "select",
      visibleWhen: forAction("netspeed"),
      options: [
        { value: "both", label: t("triggerBoth") },
        { value: "any", label: t("triggerAny") },
      ],
    },
    { id: "cpuThreshold", label: t("thresholdPct"), kind: "number", visibleWhen: forAction("cpu"), validate: nonNegative },
    { id: "cpuDuration", label: t("sustainedMinutes"), kind: "number", visibleWhen: forAction("cpu"), validate: nonNegative },
    { id: "maxWaitSeconds", label: t("maxWait"), kind: "number", visibleWhen: forAction("netspeed", "cpu"), validate: nonNegative },
    {
      id: "powerMode",
      label: t("powerMode"),
      kind: "select",
      visibleWhen: forAction("countdown", "specific_time", "netspeed", "cpu"),
      options: [
        { value: "sleep", label: t("powerSleep") },
        { value: "shutdown", label: t("powerOff") },
        { value: "restart", label: t("powerReboot") },
      ],
    },
    {
      id: "dryrun",
      label: t("dryRun"),
      description: t("dryRunHint"),
      kind: "boolean",
      visibleWhen: forAction("countdown", "specific_time", "netspeed", "cpu"),
    },
  ]

  return {
    id: "sleept",
    title: t("name"),
    description: t("description"),
    initialValues,
    fields,
    toInput: sleeptInputFromInteractionValues,
    validate(_values, input) {
      if (input.action === "countdown" && countdownSeconds(input) <= 0) return t("durationRequired")
      if (input.action === "specific_time") return validateTarget(input.targetDatetime ?? "", t("targetRequired"))
      return null
    },
    preview(input) {
      const action = actionLabel(input.action as SleeptInteractionAction, t)
      const lines = [t("previewAction", { value: action })]
      if (input.action === "countdown") lines.push(t("previewDuration", { value: formatDuration(countdownSeconds(input)) }))
      if (input.action === "specific_time") lines.push(t("previewTarget", { value: input.targetDatetime ?? "" }))
      if (input.action === "netspeed") {
        lines.push(t("previewThreshold", { value: `${input.uploadThreshold}/${input.downloadThreshold} KB/s` }))
      }
      if (input.action === "cpu") lines.push(t("previewThreshold", { value: `${input.cpuThreshold}%` }))
      if (input.action === "netspeed" || input.action === "cpu") {
        lines.push(t("previewWait", { value: input.maxWaitSeconds === 0 ? t("unlimited") : `${input.maxWaitSeconds}s` }))
      }
      if (input.action !== "get_stats") {
        lines.push(t("previewPower", { value: powerLabel(input.powerMode ?? "sleep", t) }))
        lines.push(t("previewDryRun", { value: input.dryrun ? t("dryRun") : t("live") }))
      }
      return lines
    },
    isDangerous: (input) => input.action !== "get_stats" && !input.dryrun,
    result(result) {
      const lines: string[] = []
      if (result.data?.timerStatus) lines.push(t("resultState", { value: result.data.timerStatus }))
      if (result.data?.targetTime) lines.push(t("resultTarget", { value: result.data.targetTime }))
      return { success: result.success, message: result.message, lines }
    },
  }
}

export function sleeptInputFromInteractionValues(values: Readonly<InteractionValues>): SleeptInput {
  const action = values.action as SleeptInteractionAction
  if (action === "get_stats") return { action }
  return {
    action,
    powerMode: asPowerMode(values.powerMode),
    hours: asNumber(values.hours, 0),
    minutes: asNumber(values.minutes, 0),
    seconds: asNumber(values.seconds, 5),
    targetDatetime: String(values.targetDatetime ?? ""),
    uploadThreshold: asNumber(values.uploadThreshold, 242),
    downloadThreshold: asNumber(values.downloadThreshold, 242),
    netDuration: asNumber(values.netDuration, 2),
    netTriggerMode: values.netTriggerMode === "any" ? "any" : "both",
    cpuThreshold: asNumber(values.cpuThreshold, 10),
    cpuDuration: asNumber(values.cpuDuration, 2),
    dryrun: values.dryrun !== false,
    maxWaitSeconds: asNumber(values.maxWaitSeconds, 3600),
  }
}

function validateNumber(value: InteractionValue, min: number, message: string): string | null {
  const number = Number(value)
  return Number.isFinite(number) && number >= min ? null : message
}

function validateTarget(value: string, message: string): string | null {
  try {
    parseTargetDatetime(value)
    return null
  } catch {
    return message
  }
}

function asNumber(value: InteractionValue | undefined, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function asPowerMode(value: InteractionValue | undefined): PowerMode {
  return value === "shutdown" || value === "restart" ? value : "sleep"
}

type Translator = ReturnType<typeof createSleeptTranslator>

function actionLabel(action: SleeptInteractionAction, t: Translator): string {
  if (action === "specific_time") return t("timerAt")
  if (action === "netspeed") return t("timerNet")
  if (action === "cpu") return t("timerCpu")
  if (action === "get_stats") return t("statusAction")
  return t("timerCountdown")
}

function powerLabel(mode: PowerMode, t: Translator): string {
  if (mode === "shutdown") return t("powerOff")
  if (mode === "restart") return t("powerReboot")
  return t("powerSleep")
}
