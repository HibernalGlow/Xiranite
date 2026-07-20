/* @jsxImportSource @opentui/react */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

import { DevTui } from "./dev-tui-app"
import { ManagedDevTuiController, type DevTarget } from "./dev-tui-controller"

const [targetArg, ...args] = process.argv.slice(2)
if (targetArg === "--help" || targetArg === "-h") {
  console.log("Usage: bun scripts/dev-tui.tsx <dev|dev:desktop> [dev arguments]")
  process.exit(0)
}
if (targetArg !== "dev" && targetArg !== "dev:desktop") {
  console.error("Expected dev target: dev or dev:desktop")
  process.exit(2)
}

const target = targetArg as DevTarget
const controller = new ManagedDevTuiController(target, target === "dev" ? "XR Browser" : "XRD Desktop", args)
await controller.detectExistingSession()

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  clearOnShutdown: true,
  useMouse: true,
  enableMouseMovement: true,
  screenMode: "alternate-screen",
})
const root = createRoot(renderer)
let exiting = false

async function exit() {
  if (exiting) return
  exiting = true
  await controller.stop()
  root.unmount()
  renderer.destroy()
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void exit() })
root.render(<DevTui controller={controller} onExit={() => { void exit() }} />)
