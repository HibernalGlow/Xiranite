/**
 * A second contributed component in the same remote — the `./Panel` expose.
 *
 * It exists to answer the question the single-entry example could not: a plugin that contributes more
 * than one component must fetch a *different* expose per row, and the host must be able to open both.
 * Before `dynamicEntries.exposeOfModule` every row after the bound module id was listed in the module
 * library and then failed to load.
 *
 * Same shape as `./entry` on purpose: a contributed row is an entry module (`def` + `Component`), not a
 * bare React component, because that is what the host's renderer consumes.
 */

import { useState } from "react"

import "./theme.css"

import type { PluginNodeEntry } from "@xiranite/plugin-sdk"

import type { PluginComponentProps } from "./pluginTypes"

const def = {
  id: "example.panel",
  name: "Second Contributed Panel",
  version: "0.0.0",
  category: "PLUGIN",
  description: "Served by the same remote under the ./Panel expose.",
  icon: "Puzzle",
}

function Component({ compId, host }: PluginComponentProps) {
  const [lazyText, setLazyText] = useState<string | undefined>(undefined)
  const [lazyError, setLazyError] = useState<string | undefined>(undefined)
  return (
    <div data-xr-second-panel="" style={{ padding: 16, font: "13px/1.7 ui-sans-serif,system-ui,sans-serif" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>{def.name}</h3>
      {/* The marker is the evidence: this string exists only in this file, so seeing it proves the
          loader asked for ./Panel rather than the default ./entry. */}
      <p data-xr-panel-marker="" style={{ margin: 0 }}>
        XR-PANEL-MARKER-7731 compId=<code>{compId}</code> 授权=
        <code>{(host.contract?.supportedCapabilities ?? []).join(", ") || "（无）"}</code>
      </p>
      {/* §6's open question made testable: does a chunk fetched only on click go through the same
          integrity hook? The URL is unknowable until the build names it, so a live probe pins it. */}
      <p style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={async () => {
            try {
              const mod = await import("./lazy-note")
              setLazyText(mod.LAZY_TEXT)
            } catch (error) {
              setLazyError(error instanceof Error ? error.message : String(error))
            }
          }}>
          加载懒块
        </button>{" "}
        <span data-xr-css-probe=""></span>{" "}<span data-xr-lazy-result="" style={{ opacity: 0.75 }}>{lazyText ?? lazyError ?? "（还没加载）"}</span>
      </p>
    </div>
  )
}

const entry: PluginNodeEntry = { def, Component }

export default entry
