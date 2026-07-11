import type { ReadStream, WriteStream } from "node:tty"
import { render } from "ink"

import type { TerminalInteractionDefinition } from "../../interaction.js"
import type { RunTerminalUiOptions } from "../index.js"
import { InkTerminalApp } from "./app.js"

export async function runInkTerminalUi<Input, Result>(
  definition: TerminalInteractionDefinition<Input, Result>,
  options: RunTerminalUiOptions & { language: "en" | "zh" },
): Promise<void> {
  const app = render(
    <InkTerminalApp definition={definition} language={options.language} theme={options.theme} onExit={() => app.unmount()} />,
    {
      stdin: options.host.stdin as ReadStream,
      stdout: options.host.stdout as WriteStream,
      stderr: options.host.stderr as WriteStream,
      exitOnCtrlC: true,
      patchConsole: false,
    },
  )
  await app.waitUntilExit()
}
