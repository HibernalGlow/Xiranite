import type { CliHost } from "../index.js"
import type { TerminalInteractionDefinition, TerminalRenderer } from "../interaction.js"
import { resolveTerminalLanguage, type TerminalLanguage } from "./i18n.js"
import { isBunRuntime, reexecTerminalUiWithBun } from "./bun-runtime.js"

export interface RunTerminalUiOptions {
  renderer?: TerminalRenderer
  language?: TerminalLanguage | string
  theme?: string
  host: CliHost
  reexec?: { entrypoint: string; args: readonly string[] }
}

export async function runTerminalUi<Input, Result>(
  definition: TerminalInteractionDefinition<Input, Result>,
  options: RunTerminalUiOptions,
): Promise<void> {
  const renderer = options.renderer ?? "ink"
  const language = resolveTerminalLanguage(options.language, options.host.env)
  if (renderer === "opentui") {
    if (!isBunRuntime()) {
      await reexecTerminalUiWithBun(options.host, options.reexec)
      return
    }
    const { runOpenTuiTerminalUi } = await import("./opentui/runner.js")
    await runOpenTuiTerminalUi(definition, { ...options, language })
    return
  }
  const { runInkTerminalUi } = await import("./ink/runner.js")
  await runInkTerminalUi(definition, { ...options, language })
}

export {
  createCliI18n,
  createI18nTranslator,
  createTerminalTranslator,
  resolveTerminalLanguage,
  terminalMessages,
  type CliI18nResources,
  type I18nInterpolationValues,
  type TerminalLanguage,
  type TerminalMessageKey,
} from "./i18n.js"
export { listTerminalThemes, registerTerminalTheme, resolveTerminalTheme, type TerminalTheme } from "./theme.js"
export { isBunRuntime, reexecTerminalUiWithBun } from "./bun-runtime.js"
