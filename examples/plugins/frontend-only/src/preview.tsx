/**
 * Standalone preview: renders the plugin's exposed entry without Xiranite running.
 *
 * The `host` here is a stand-in, not the real one — it exists so a plugin author can develop with
 * `vite dev` alone. Anything that matters (single React instance, host-granted capabilities, the
 * `xiranite.fs.*` round trip) is only true when the plugin is loaded by the host through
 * `plugin-host.html`; do not treat this page as proof of that.
 */

import { createRoot } from "react-dom/client"
import entry from "./entry"
import type { PluginHostApi } from "./pluginTypes"

const previewHost: PluginHostApi = {
  env: { theme: "dark", platform: "web" },
  contract: {
    name: "xiranite-host-preview",
    version: "0.0.0",
    supportedCapabilities: ["contract", "env"],
    hasCapability: (capability) => ["contract", "env"].includes(capability),
  },
  state: { getData: () => ({}), patchData: () => undefined },
  config: { get: () => undefined, save: () => undefined },
}

const Component = entry.Component

createRoot(document.getElementById("root")!).render(
  <Component compId="standalone-preview" host={previewHost} />,
)
