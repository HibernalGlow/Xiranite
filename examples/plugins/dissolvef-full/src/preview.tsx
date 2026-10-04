/**
 * Standalone preview: renders the plugin's exposed entry without Xiranite running.
 *
 * The stand-in host has **no** `runner.run`, which is the honest shape: the whole point of this plugin
 * is a call that goes to a real Extism-hosted wasm, and there is nothing to pretend with here. Open
 * `plugin-host.html` in the host to get the working chain; treat this page as layout only.
 */

import { createRoot } from "react-dom/client"
import entry from "./entry"
import type { PluginHost } from "./pluginTypes"

const previewHost: PluginHost = {
  env: { theme: "dark", platform: "web" },
  contract: {
    name: "xiranite-host-preview",
    version: "0.0.0",
    supportedCapabilities: ["contract", "env"],
  },
}

const Component = entry.Component

createRoot(document.getElementById("root")!).render(
  <Component compId="standalone-preview" host={previewHost} />,
)
