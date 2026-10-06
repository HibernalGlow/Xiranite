/**
 * The plugin's entry module — the remote's `./entry` expose.
 *
 * It deliberately mirrors `AppNodeEntry` (`packages/contract`) instead of inventing a plugin API:
 * `def` plus a `Component` that receives `{ compId, host }`. That is what makes a frontend plugin
 * and an internal node the same thing to the host's renderer, and why no existing node needs
 * rewriting to keep working (`docs/plugin-architecture.md` §2.3).
 *
 * This example omits `core` on purpose: `AppNodeEntry.core` is optional because a frontend-only
 * plugin has no in-process core, while `HeadlessNodePackage.core` stays required for the node
 * packages that call their own core (`packages/contract`). Nothing in the host reads `entry.core`,
 * so a remote never has to fabricate one to satisfy the shape the renderer asks for.
 */

import { useState, version as reactVersion } from "react"

import type { PluginComponentProps } from "./pluginTypes"

const def = {
  id: "poc-frontend",
  name: "POC Frontend-only Plugin",
  version: "0.0.0",
  category: "file",
  description: "Built outside the Xiranite repository, loaded at runtime through Module Federation.",
  icon: "Puzzle",
}

function Component({ compId, host }: PluginComponentProps) {
  // A working hook is itself evidence: with a second React copy this throws "Invalid hook call".
  const [taps, setTaps] = useState(0)
  const theme = host.env?.theme ?? "unknown"
  const capabilities = host.contract?.supportedCapabilities ?? []

  return (
    <div style={{ padding: 16, font: "13px/1.7 ui-sans-serif,system-ui,sans-serif" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>
        {def.name} <span style={{ opacity: 0.5 }}>react {reactVersion}</span>
      </h3>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px 12px" }}>
        <dt>compId</dt>
        <dd><code>{compId}</code></dd>
        <dt>host.env.theme</dt>
        <dd><code>{String(theme)}</code></dd>
        <dt>host 授予的能力</dt>
        <dd><code>{capabilities.join(", ") || "（无）"}</code></dd>
      </dl>
      <p style={{ marginTop: 12 }}>
        <button type="button" onClick={() => setTaps((value) => value + 1)}>
          点我（插件自己的 state）
        </button>{" "}
        <span style={{ opacity: 0.7 }}>已点 {taps} 次</span>
      </p>
    </div>
  )
}

export default { def, Component }
