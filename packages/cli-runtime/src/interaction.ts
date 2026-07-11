import type { CliHost } from "./index.js"

export type InteractionMode = "ui" | "gd"
export type CliInvocationMode = InteractionMode | "pipe"
export type TerminalRenderer = "opentui"
export type InteractionValue = string | number | boolean
export type InteractionValues = Record<string, InteractionValue>

export interface InteractionOption<Value extends InteractionValue = InteractionValue> {
  value: Value
  label: string
  hint?: string
  disabled?: boolean
}

export interface InteractionField {
  id: string
  label: string
  description?: string
  kind: "text" | "number" | "select" | "boolean"
  options?: readonly InteractionOption[]
  placeholder?: string
  min?: number
  max?: number
  step?: number
  visibleWhen?: (values: Readonly<InteractionValues>) => boolean
  validate?: (value: InteractionValue, values: Readonly<InteractionValues>) => string | null
}

export interface TerminalViewSection {
  id: string
  title: string
  description?: string
  fieldIds: readonly string[]
}

export interface TerminalViewMetric {
  label: string
  value: string
}

export interface TerminalViewDisplay {
  primary: string
  secondary?: string
  metrics?: readonly TerminalViewMetric[]
}

/**
 * Renderer-neutral content grouping owned by the independently distributed
 * node. It intentionally contains no positions, widths, widgets, or input API.
 */
export interface TerminalInteractionView {
  sections: readonly TerminalViewSection[]
  dashboard: {
    title: string
    description?: string
    display: (values: Readonly<InteractionValues>) => TerminalViewDisplay
  }
}

export interface TerminalInteractionSchema<Input, Result> {
  id: string
  title: string
  description: string
  initialValues: InteractionValues
  fields: readonly InteractionField[]
  view?: TerminalInteractionView
  toInput: (values: Readonly<InteractionValues>) => Input
  validate?: (values: Readonly<InteractionValues>, input: Input) => string | null
  preview: (input: Input) => readonly string[]
  isDangerous: (input: Input) => boolean
  dangerPrompt?: (input: Input) => {
    title: string
    body: string
    confirmLabel: string
  }
  result: (result: Result) => {
    success: boolean
    message: string
    lines?: readonly string[]
  }
}

export interface TerminalInteractionEvent {
  type: string
  progress?: number
  message: string
}

export interface TerminalInteractionDefinition<Input, Result> {
  schema: TerminalInteractionSchema<Input, Result>
  run: (input: Input, onEvent: (event: TerminalInteractionEvent) => void) => Promise<Result>
  cancel?: () => void
}

export interface TerminalRendererResolution {
  renderer?: TerminalRenderer
  args: string[]
  error?: string
}

export interface TerminalUiFlagDefaults {
  renderer?: TerminalRenderer
  language?: "en" | "zh"
  theme?: string
}

export interface TerminalUiFlagResolution extends TerminalRendererResolution {
  language?: "en" | "zh"
  theme?: string
}

export interface CliInteractionPreferencesSource {
  interaction_mode?: InteractionMode
  interaction_renderer?: TerminalRenderer
  interaction_language?: "en" | "zh"
  interaction_theme?: string
  interactionMode?: InteractionMode
  interactionRenderer?: TerminalRenderer
  interactionLanguage?: "en" | "zh"
  interactionTheme?: string
}

export interface CliInteractionPreferences {
  mode: InteractionMode
  renderer: TerminalRenderer
  language?: "en" | "zh"
  theme: string
}

/**
 * Routes an invocation without ever accidentally rendering an interactive UI
 * into a pipeline. `guided` is retained as the legacy spelling of `gd`.
 */
export function resolveCliInvocation(args: readonly string[], host: CliHost, defaultMode: InteractionMode = "ui"): CliInvocationMode {
  const first = args[0]?.toLowerCase()
  if (first === "ui") return "ui"
  if (first === "gd" || first === "guided") return "gd"
  if (args.length > 0) return "pipe"
  return host.stdin.isTTY && host.stdout.isTTY ? defaultMode : "pipe"
}

export function requireInteractiveMode(host: CliHost, mode: InteractionMode): string | null {
  return host.stdin.isTTY && host.stdout.isTTY ? null : `\`${mode}\` mode requires an interactive terminal. Use a subcommand with --json for scripted use.`
}

/** Extracts the renderer flag without exposing it to node-specific schemas. */
export function resolveTerminalRenderer(args: readonly string[], defaultRenderer: TerminalRenderer = "opentui"): TerminalRendererResolution {
  let renderer: string = defaultRenderer
  const remaining: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (arg === "--renderer") {
      const value = args[index + 1]
      if (!value) return { args: remaining, error: "--renderer requires opentui." }
      renderer = value.toLowerCase()
      index += 1
      continue
    }
    if (arg.startsWith("--renderer=")) {
      renderer = arg.slice("--renderer=".length).toLowerCase()
      continue
    }
    remaining.push(arg)
  }

  if (renderer !== "opentui") {
    return { args: remaining, error: `Unknown terminal renderer: ${renderer}. Use opentui.` }
  }
  return { renderer, args: remaining }
}

export function resolveTerminalUiFlags(
  args: readonly string[],
  defaults: TerminalUiFlagDefaults = {},
): TerminalUiFlagResolution {
  let renderer: string = defaults.renderer ?? "opentui"
  let language: string | undefined = defaults.language
  let theme = defaults.theme
  const remaining: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    const [name, inlineValue] = arg.split("=", 2)
    if (name !== "--renderer" && name !== "--lang" && name !== "--theme") {
      remaining.push(arg)
      continue
    }
    const value = inlineValue || args[index + 1]
    if (!value) return { args: remaining, error: `${name} requires a value.` }
    if (!inlineValue) index += 1
    if (name === "--renderer") renderer = value.toLowerCase()
    if (name === "--lang") language = value.toLowerCase().startsWith("zh") ? "zh" : value.toLowerCase().startsWith("en") ? "en" : value
    if (name === "--theme") theme = value.toLowerCase()
  }

  if (renderer !== "opentui") {
    return { args: remaining, error: `Unknown terminal renderer: ${renderer}. Use opentui.` }
  }
  if (language !== undefined && language !== "en" && language !== "zh") {
    return { args: remaining, error: `Unknown terminal language: ${language}. Use en or zh.` }
  }
  return { renderer, language, theme, args: remaining }
}

export function resolveInteractionPreferences(source: CliInteractionPreferencesSource | undefined): CliInteractionPreferences {
  return {
    mode: source?.interaction_mode ?? source?.interactionMode ?? "ui",
    renderer: source?.interaction_renderer ?? source?.interactionRenderer ?? "opentui",
    language: source?.interaction_language ?? source?.interactionLanguage,
    theme: source?.interaction_theme?.trim() || source?.interactionTheme?.trim() || "default",
  }
}
