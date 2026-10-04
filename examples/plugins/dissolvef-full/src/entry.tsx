/**
 * The full-form example's entry module — the remote's `./entry` expose.
 *
 * What this file is meant to prove: a frontend built **outside the repository**, loaded at runtime
 * through Module Federation 2.0, can drive a backend that lives as `dissolvef.wasm` behind Extism. It
 * does that through one host-injected call, `host.runner.run(BACKEND_NODE_ID, input, onEvent)`, and
 * nothing else: no token, no `fetch`, no knowledge of Axum, no knowledge of Extism. The chain it
 * exercises is therefore exactly the production chain
 * (`docs/plugin-architecture.md` §2.4, §10.3):
 *
 *   this Component -> host.runner (host realm) -> POST /nodes/dissolvef/operations (Axum)
 *                  -> NodeRuntime launcher -> Extism -> dissolvef.wasm -> xiranite.fs.*
 *                  -> NDJSON /node-operations/:id/stream -> onEvent -> this Component
 *
 * Two deliberate omissions, both recorded as gaps rather than worked around:
 *   - `BACKEND_NODE_ID` is a literal. It belongs in the plugin manifest's `[backend]` section, which
 *     nothing parses yet; a Manager must validate it before a plugin may call an arbitrary node,
 *     because today any frontend in the host realm can address any staged backend.
 *   - `preview` is a checkbox with no gate. A real plugin must render the danger confirmation from the
 *     node's published definition (`NodeDefinition`/`DangerGate`, ADR-0069); this example only shows
 *     where that call would go.
 */

import { useState, version as reactVersion } from "react"

import type { NodeRunEvent, NodeRunResult, PluginComponentProps } from "./pluginTypes"

const BACKEND_NODE_ID = "dissolvef"

/** The actions this example exposes, all spelled as `crates/nodes/dissolvef/src/contract.rs` parses them. */
const ACTIONS = ["plan", "dissolve", "history", "undo"] as const
type Action = (typeof ACTIONS)[number]

interface DissolvefInput {
  action: Action
  path: string
  preview: boolean
  fileConflict: string
  dirConflict: string
  enableSimilarity: boolean
  similarityThreshold: number
  protectFirstLevel: boolean
  exclude: string
  historyPath: string
  historyLimit: number
  undoId: string
  skipBlacklist: boolean
}

/** `DissolvefInput` with the node's own defaults; only the four fields the UI edits are overridden. */
function buildInput(overrides: Partial<DissolvefInput>): DissolvefInput {
  return {
    action: "plan",
    path: "",
    preview: true,
    fileConflict: "auto",
    dirConflict: "auto",
    enableSimilarity: true,
    similarityThreshold: 0.6,
    protectFirstLevel: true,
    exclude: "",
    historyPath: "",
    historyLimit: 20,
    undoId: "",
    skipBlacklist: false,
    ...overrides,
  }
}

/** `core.ts`'s plan document puts the rows at `data.plan`; read it defensively because `data` is `unknown`. */
function planRows(result: NodeRunResult<unknown> | undefined): number | undefined {
  const data = result?.data as { plan?: unknown } | undefined
  return Array.isArray(data?.plan) ? data.plan.length : undefined
}

const def = {
  id: "dissolvef-full",
  name: "DissolveF (MF2 + Extism)",
  version: "0.0.0",
  category: "file",
  description: "Frontend built outside the repository; backend runs as dissolvef.wasm under Extism.",
  icon: "FolderOpen",
}

function Component({ compId, host }: PluginComponentProps) {
  const [path, setPath] = useState("")
  const [action, setAction] = useState<Action>("plan")
  const [preview, setPreview] = useState(true)
  const [events, setEvents] = useState<NodeRunEvent[]>([])
  const [result, setResult] = useState<NodeRunResult<unknown> | undefined>()
  const [running, setRunning] = useState(false)

  const runner = host.runner?.run
  const capabilities = host.contract?.supportedCapabilities ?? []

  async function execute() {
    if (!runner) return
    setRunning(true)
    setEvents([])
    setResult(undefined)
    try {
      const outcome = await runner(BACKEND_NODE_ID, buildInput({ path, action, preview }), (event) => {
        setEvents((current) => [...current, event])
      })
      setResult(outcome)
    } catch (error) {
      // A plugin has to render whatever the host throws: `host.runner.run` is not only a network call,
      // and the failure can come from the host's own state before a request is ever made. Without this
      // branch the UI silently keeps "—" and the reader cannot tell "not wired" from "crashed".
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      setResult({ success: false, message: `host.runner.run threw: ${message}` })
    } finally {
      setRunning(false)
    }
  }

  const rows = planRows(result)

  return (
    <div style={{ padding: 16, font: "13px/1.7 ui-sans-serif,system-ui,sans-serif", maxWidth: 760 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>
        {def.name} <span style={{ opacity: 0.5 }}>react {reactVersion}</span>
      </h3>
      <p style={{ margin: "0 0 12px", opacity: 0.7 }}>
        compId <code>{compId}</code> · 前端为仓库外构建的 MF2 remote，后端为 <code>{BACKEND_NODE_ID}.wasm</code>（Extism）·
        主题 {String(host.env?.theme ?? "unknown")}
      </p>

      <label style={{ display: "block", marginBottom: 8 }}>
        库目录
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="/absolute/path/to/Library"
          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", font: "12px ui-monospace,monospace" }}
        />
      </label>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          动作
          <select value={action} onChange={(event) => setAction(event.target.value as Action)} style={{ marginLeft: 6 }}>
            {ACTIONS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} />
          preview（不关就会动盘）
        </label>
        <button type="button" disabled={running || !runner || !path} onClick={execute}>
          {running ? "运行中…" : "执行"}
        </button>
        {!runner && <span style={{ color: "#b3261e" }}>宿主未注入 host.runner</span>}
      </div>

      <dl
        style={{
          margin: "12px 0 0",
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: "2px 12px",
          font: "12px/1.6 ui-monospace,monospace",
        }}
      >
        <dt>结果</dt>
        <dd>
          {result === undefined
            ? "—"
            : `${result.success ? "success" : "failed"}：${result.message}${rows === undefined ? "" : `（${rows} 行计划）`}`}
        </dd>
        <dt>stats</dt>
        <dd>{result?.stats ? JSON.stringify(result.stats) : "—"}</dd>
        <dt>事件数</dt>
        <dd>{events.length}</dd>
        <dt>host 授予的能力</dt>
        <dd>{capabilities.join(", ") || "（无）"}</dd>
      </dl>

      <pre
        style={{
          marginTop: 12,
          padding: 10,
          height: 180,
          overflow: "auto",
          background: "rgba(127,127,127,0.08)",
          border: "1px solid rgba(127,127,127,0.25)",
          font: "11px/1.6 ui-monospace,monospace",
          whiteSpace: "pre-wrap",
        }}
      >
        {events.map((event, index) => `${index} ${event.type} ${event.progress ?? ""} ${event.message}`.trim()).join("\n") ||
          "（尚无事件）"}
      </pre>
    </div>
  )
}

export default { def, Component }
