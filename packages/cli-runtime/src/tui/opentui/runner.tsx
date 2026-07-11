/* @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import type { ReadStream, WriteStream } from "node:tty"

import type { TerminalInteractionDefinition } from "../../interaction.js"
import type { RunTerminalUiOptions } from "../index.js"
import { OpenTuiTerminalApp } from "./app.js"

export async function runOpenTuiTerminalUi<Input, Result>(
  definition: TerminalInteractionDefinition<Input, Result>,
  options: RunTerminalUiOptions & { language: "en" | "zh" },
): Promise<void> {
  let resolveDestroyed: (() => void) | undefined
  const destroyed = new Promise<void>((resolve) => {
    resolveDestroyed = resolve
  })
  const renderer = await createCliRenderer({
    stdin: options.host.stdin as ReadStream,
    stdout: options.host.stdout as WriteStream,
    exitOnCtrlC: true,
    clearOnShutdown: true,
    useMouse: true,
    enableMouseMovement: true,
    screenMode: "alternate-screen",
    onDestroy: () => resolveDestroyed?.(),
  })
  const root = createRoot(renderer)
  const exit = () => {
    root.unmount()
    renderer.destroy()
  }
  root.render(<OpenTuiTerminalApp definition={definition} language={options.language} theme={options.theme} onExit={exit} />)
  await destroyed
}
