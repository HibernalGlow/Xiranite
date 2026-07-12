/* @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useState, type ReactNode } from "react"
import type { ReadStream, WriteStream } from "node:tty"

import type { TerminalInteractionDefinition } from "../../interaction.js"
import type { RunTerminalUiOptions } from "../index.js"
import { OpenTuiTerminalApp } from "./app.js"
import { TerminalTaskQueueScreen } from "./task-queue-screen.js"
import { TerminalHelpScreen } from "./help-screen.js"
import { ClickTarget } from "./workbench-controls.js"
import type { TerminalTaskQueueController } from "../task-queue.js"

export async function runOpenTuiTerminalUi<Input, Result>(
  definition: TerminalInteractionDefinition<Input, Result>,
  options: RunTerminalUiOptions<Input, Result> & { language: "en" | "zh" },
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
  const screen = options.screen ?? await options.loadScreen?.()
  const Screen = screen
  const content = Screen
    ? <Screen definition={definition} language={options.language} theme={options.theme} preferences={options.preferences} help={options.help} onExit={exit} />
    : <OpenTuiTerminalApp definition={definition} language={options.language} theme={options.theme} preferences={options.preferences} help={options.help} onExit={exit} />
  root.render(<TerminalRoot taskQueue={options.taskQueue} help={options.help} language={options.language} content={content} />)
  await destroyed
}

function TerminalRoot({ taskQueue, help, language, content }: { taskQueue?: TerminalTaskQueueController; help?: import("@xiranite/contract").NodeHelp; language: "zh" | "en"; content: ReactNode }) {
  const [showQueue, setShowQueue] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  useKeyboard((key) => {
    if (key.name === "f9") setShowQueue((value) => !value)
    if (key.name === "f1" && help) setShowHelp((value) => !value)
    if (showQueue && key.name === "escape") setShowQueue(false)
    if (showHelp && key.name === "escape") setShowHelp(false)
  })
  if (showQueue && taskQueue) return <TerminalTaskQueueScreen controller={taskQueue} onBack={() => setShowQueue(false)} />
  if (showHelp && help) return <TerminalHelpScreen help={help} language={language} onBack={() => setShowHelp(false)} />
  return <box width="100%" height="100%" position="relative">{content}<box position="absolute" top={0} right={2} flexDirection="row">{help ? <ClickTarget id="help-entry" bordered onClick={() => setShowHelp(true)}>? 帮助 F1</ClickTarget> : null}{taskQueue ? <ClickTarget id="task-queue-entry" bordered onClick={() => setShowQueue(true)}>▤ 任务队列 F9</ClickTarget> : null}</box></box>
}
