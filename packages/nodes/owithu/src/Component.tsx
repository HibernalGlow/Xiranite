import { useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, Copy, Eye, MousePointerClick, RotateCcw, ShieldMinus, ShieldPlus } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, TextArea, createUnavailableNodeRunner } from "@xiranite/ui"
import type { OwithuAction, OwithuData, OwithuInput, OwithuResult, RegistryHive } from "./core.js"
import { buildOwithuPlan, parseOwithuConfig } from "./core.js"

interface OwithuCardState {
  path?: string
  configText?: string
  hive?: RegistryHive | ""
  onlyKey?: string
  action?: OwithuAction
  result?: OwithuData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const data = host.getData<OwithuCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
  const logs = data.logs ?? []
  const result = data.result ?? null
  const hive = data.hive ?? ""

  function patch(patchData: Partial<OwithuCardState>) {
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-40), message] })
  }

  async function pasteConfig() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ configText: text })
  }

  async function execute(action: OwithuAction) {
    if (running) return

    if (action === "preview" && data.configText?.trim()) {
      try {
        const config = parseOwithuConfig(data.configText)
        const plan = buildOwithuPlan(config, { action: "register", hive, onlyKey: data.onlyKey })
        patch({
          phase: "completed",
          action,
          result: { vars: config.vars, defaults: config.defaults, entries: config.entries, plan, registeredCount: 0, unregisteredCount: 0, failedCount: 0, errors: [] },
        })
        log(`preview: ${config.entries.length} entries / ${plan.length} registry ops`)
      } catch (error) {
        log(error instanceof Error ? error.message : String(error))
      }
      return
    }

    const runNode = createUnavailableNodeRunner("Native action is unavailable in the shell-less Component. Paste TOML to preview locally or use the xiranite-owithu CLI for registry changes.")

    setRunning(true)
    patch({ phase: "running", action })
    const input: OwithuInput = {
      action,
      path: data.path,
      configText: data.configText,
      hive,
      onlyKey: data.onlyKey,
    }
    const response = await runNode<OwithuInput, OwithuData>("owithu", input, (event) => {
      if (event.type === "log") log(event.message)
    }) as OwithuResult
    patch({ phase: response.success ? "completed" : "error", result: response.data ?? null })
    log(response.message)
    setRunning(false)
  }

  function reset() {
    patch({ phase: "idle", result: null, logs: [] })
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title="owithu"
        meta={`${data.phase ?? "idle"} / ${result?.entries.length ?? 0} entries / ${result?.plan.length ?? 0} ops`}
        actions={
          <>
            <IconButton title="Paste TOML" onClick={pasteConfig}><Clipboard size={14} /></IconButton>
            <ActionButton disabled={running} onClick={() => execute("preview")}><Eye size={14} /> Preview</ActionButton>
            <ActionButton variant="primary" disabled={running} onClick={() => execute("register")}><ShieldPlus size={14} /> Register</ActionButton>
            <ActionButton disabled={running} onClick={() => execute("unregister")}><ShieldMinus size={14} /> Remove</ActionButton>
            <IconButton title="Copy logs" onClick={copyLogs}><Copy size={14} /></IconButton>
            <IconButton title="Reset" onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap gap-2">
          <Field label="config path" value={data.path ?? ""} disabled={running} onChange={(event) => patch({ path: event.currentTarget.value })} />
          <Field label="only key" value={data.onlyKey ?? ""} disabled={running} onChange={(event) => patch({ onlyKey: event.currentTarget.value })} />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <SegmentButton active={!hive} disabled={running} onClick={() => patch({ hive: "" })}>config</SegmentButton>
          {(["HKCU", "HKCR", "HKLM"] as const).map((item) => (
            <SegmentButton key={item} active={hive === item} disabled={running} onClick={() => patch({ hive: item })}>{item}</SegmentButton>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <TextArea
            label="toml"
            value={data.configText ?? ""}
            disabled={running}
            onChange={(event) => patch({ configText: event.currentTarget.value })}
            placeholder="paste owithu.toml for local preview"
          />
          <ResultView className="text-muted-foreground">
            {result?.plan.length ? result.plan.slice(0, 80).map((item) => (
              <div key={`${item.registryPath}:${item.command}`} className="mb-1">
                <div className="truncate text-primary"><MousePointerClick size={11} className="mr-1 inline" />{item.entryKey} / {item.hive} / {item.scope}</div>
                <div className="truncate">{item.command}</div>
              </div>
            )) : <div className="flex h-full items-center justify-center">No registry plan</div>}
          </ResultView>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label="entries" value={result?.entries.length ?? 0} />
          <StatPill label="ops" value={result?.plan.length ?? 0} tone="accent" />
          <StatPill label="registered" value={result?.registeredCount ?? 0} tone="good" />
          <StatPill label="failed" value={result?.failedCount ?? 0} tone={result?.failedCount ? "bad" : "neutral"} />
        </div>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}
