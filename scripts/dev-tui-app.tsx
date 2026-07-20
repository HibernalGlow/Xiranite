/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useEffect, useState } from "react"

import type { DevPhase, DevTuiController, DevTuiSnapshot } from "./dev-tui-controller"

const colors = {
  primary: "#88C0D0",
  foreground: "#ECEFF4",
  muted: "#7B8498",
  border: "#4C566A",
  success: "#A3BE8C",
  warning: "#EBCB8B",
  error: "#BF616A",
}

export function DevTui({ controller, onExit }: { controller: DevTuiController; onExit: () => void }) {
  const [snapshot, setSnapshot] = useState(() => controller.snapshot())
  const [now, setNow] = useState(Date.now())
  const [exitConfirm, setExitConfirm] = useState(false)

  useEffect(() => controller.subscribe(() => setSnapshot(controller.snapshot())), [controller])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  useKeyboard((key) => {
    if (exitConfirm) {
      if (key.name === "q" || key.name === "enter") onExit()
      if (key.name === "escape") setExitConfirm(false)
      return
    }
    if (key.name === "s") void controller.start()
    if (key.name === "x") void controller.stop()
    if (key.name === "r") void controller.restart()
    if (key.name === "c") controller.clearLogs()
    if (key.name === "q" || key.name === "escape") setExitConfirm(true)
  })

  const uptime = snapshot.startedAt && snapshot.phase === "running" ? formatDuration(now - snapshot.startedAt) : "-"
  const recentLogs = snapshot.lines.slice(-32).join("\n") || "No output yet. Press S to start."

  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box height={4} flexShrink={0} borderStyle="single" borderColor={colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="column">
          <text fg={colors.primary}><b>XIRANITE // DEV CONTROL</b></text>
          <text fg={colors.muted}>{`${snapshot.label} | bun run ${snapshot.target}`}</text>
        </box>
        <box flexDirection="column" alignItems="flex-end">
          <text fg={phaseColor(snapshot.phase)}><b>{snapshot.phase.toUpperCase()}</b></text>
          <text fg={colors.muted}>{snapshot.message}</text>
        </box>
      </box>

      <box height={5} flexShrink={0} marginTop={1} flexDirection="row" gap={1}>
        <Metric label="PID" value={snapshot.pid ? String(snapshot.pid) : "-"} />
        <Metric label="UPTIME" value={uptime} />
        <Metric label="LOG BUFFER" value={`${snapshot.lines.length}/600`} />
        <Metric label="DROPPED" value={String(snapshot.droppedLines)} />
      </box>

      {exitConfirm ? (
        <box height={4} flexShrink={0} borderStyle="rounded" borderColor={colors.warning} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between" alignItems="center">
          <text fg={colors.warning}><b>Exit will safely stop the managed XR/XRD session.</b></text>
          <box flexDirection="row" gap={1}><Action id="dev-exit-confirm" label="Stop + exit" keyLabel="Q" onAction={onExit} /><Action id="dev-exit-cancel" label="Cancel" keyLabel="Esc" onAction={() => setExitConfirm(false)} /></box>
        </box>
      ) : (
        <box height={4} flexShrink={0} flexDirection="row" gap={1}>
          <Action id="dev-start" label="Start" keyLabel="S" disabled={snapshot.phase === "running" || snapshot.phase === "starting"} onAction={() => void controller.start()} />
          <Action id="dev-stop" label="Stop" keyLabel="X" disabled={snapshot.phase === "stopped" || snapshot.phase === "stopping"} onAction={() => void controller.stop()} />
          <Action id="dev-restart" label="Restart" keyLabel="R" disabled={snapshot.phase === "starting" || snapshot.phase === "stopping"} onAction={() => void controller.restart()} />
          <Action id="dev-clear" label="Clear" keyLabel="C" onAction={() => controller.clearLogs()} />
          <Action id="dev-exit" label="Exit" keyLabel="Q" onAction={() => setExitConfirm(true)} />
        </box>
      )}

      <box flexGrow={1} minHeight={0} borderStyle="rounded" borderColor={colors.border} paddingLeft={1} paddingRight={1} flexDirection="column">
        <box height={2} flexShrink={0} flexDirection="row" justifyContent="space-between">
          <text fg={colors.primary}><b>LIVE OUTPUT</b></text>
          <text fg={colors.muted}>batched 100ms | latest 32 lines</text>
        </box>
        <text fg={colors.foreground}>{recentLogs}</text>
      </box>

      <box height={2} flexShrink={0} justifyContent="space-between" flexDirection="row">
        <text fg={colors.muted}>S start | X stop | R restart | C clear</text>
        <text fg={colors.muted}>Q / Esc safely stop and exit</text>
      </box>
    </box>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <box flexGrow={1} borderStyle="rounded" borderColor={colors.border} paddingLeft={1} paddingRight={1} flexDirection="column"><text fg={colors.muted}>{label}</text><text fg={colors.foreground}><b>{value}</b></text></box>
}

function Action({ id, label, keyLabel, disabled = false, onAction }: { id: string; label: string; keyLabel: string; disabled?: boolean; onAction: () => void }) {
  return <box id={id} width={14} height={3} borderStyle="rounded" borderColor={disabled ? colors.border : colors.primary} paddingLeft={1} paddingRight={1} justifyContent="center" onMouseDown={() => { if (!disabled) onAction() }}><text fg={disabled ? colors.muted : colors.foreground}>{`[${keyLabel}] ${label}`}</text></box>
}

function phaseColor(phase: DevPhase): string {
  if (phase === "running") return colors.success
  if (phase === "starting" || phase === "stopping") return colors.warning
  if (phase === "error") return colors.error
  return colors.muted
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  return `${hours > 0 ? `${hours}h ` : ""}${minutes}m ${seconds % 60}s`
}

export function createStaticDevSnapshot(overrides: Partial<DevTuiSnapshot> = {}): DevTuiSnapshot {
  return { target: "dev", label: "XR Browser", phase: "stopped", lines: [], droppedLines: 0, message: "Ready", ...overrides }
}
