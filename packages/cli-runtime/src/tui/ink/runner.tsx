import type { ReadStream, WriteStream } from "node:tty"
import { render } from "ink"

import type { TerminalInteractionDefinition } from "../../interaction.js"
import type { RunTerminalUiOptions } from "../index.js"
import { InkTerminalApp } from "./app.js"
import { enterInkFullscreen, leaveInkFullscreen } from "./lifecycle.js"

export async function runInkTerminalUi<Input, Result>(
  definition: TerminalInteractionDefinition<Input, Result>,
  options: RunTerminalUiOptions & { language: "en" | "zh" },
): Promise<void> {
  const stdout = options.host.stdout as WriteStream
  let app: ReturnType<typeof render> | undefined
  enterInkFullscreen(stdout)
  try {
    app = render(
      <InkTerminalApp definition={definition} language={options.language} theme={options.theme} onExit={() => app?.unmount()} />,
      {
        stdin: options.host.stdin as ReadStream,
        stdout,
        stderr: options.host.stderr as WriteStream,
        exitOnCtrlC: true,
        patchConsole: false,
      },
    )
    await app.waitUntilExit()
  } finally {
    app?.unmount()
    // Restore every mouse tracking mode explicitly. React effect cleanup can
    // race the final alternate-screen write during Ctrl+C or thrown errors.
    leaveInkFullscreen(stdout)
  }
}
