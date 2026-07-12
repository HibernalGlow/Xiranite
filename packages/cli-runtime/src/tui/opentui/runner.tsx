/* @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useState, type ReactNode } from "react"
import type { ReadStream, WriteStream } from "node:tty"

import type { TerminalInteractionDefinition } from "../../interaction.js"
import type { RunTerminalUiOptions } from "../index.js"
import { OpenTuiTerminalApp } from "./app.js"
import { TerminalTaskQueueScreen } from "./task-queue-screen.js"
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
    ? <Screen definition={definition} language={options.language} theme={options.theme} preferences={options.preferences} onExit={exit} />
    : <OpenTuiTerminalApp definition={definition} language={options.language} theme={options.theme} preferences={options.preferences} onExit={exit} />
  root.render(<TerminalRoot taskQueue={options.taskQueue} content={content} />)
  await destroyed
}

function TerminalRoot({ taskQueue, content }: { taskQueue?: TerminalTaskQueueController; content: ReactNode }) {
  const [showQueue, setShowQueue] = useState(false)
  useKeyboard((key) => {
    if (key.name === "f9") setShowQueue((value) => !value)
    if (showQueue && key.name === "escape") setShowQueue(false)
  })
  if (showQueue && taskQueue) return <TerminalTaskQueueScreen controller={taskQueue} onBack={() => setShowQueue(false)} />
  return <box width="100%" height="100%" position="relative">{content}{taskQueue ? <box position="absolute" top={0} right={2}><ClickTarget id="task-queue-entry" bordered onClick={() => setShowQueue(true)}>▤ 任务队列 F9</ClickTarget></box> : null}</box>
}
