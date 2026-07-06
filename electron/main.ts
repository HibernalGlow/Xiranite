import {
  createBrowserFallbackWindowHost,
  openExternalUrl,
  startRuntimeBridge,
  stopRuntimeBridge,
} from "./runtimeBridge.ts"

await startRuntimeBridge({
  windowHost: createBrowserFallbackWindowHost(),
  autoOpen: process.env.ELECTBUN_AUTO_OPEN !== "0",
  openInitialUrl: openExternalUrl,
})

process.on("SIGINT", () => {
  stopRuntimeBridge()
  process.exit(0)
})

process.on("SIGTERM", () => {
  stopRuntimeBridge()
  process.exit(0)
})
