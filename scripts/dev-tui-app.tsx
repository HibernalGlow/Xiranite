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
    if (key.name === "q" || key.name === "escape") setExitConfirm(true)
  })

  const uptime = snapshot.startedAt && (snapshot.phase === "running" || snapshot.phase === "starting")
    ? formatDuration(now - snapshot.startedAt)
    : "-"

  return (
    <box width="100%" height="100%" flexDirection="column">
      <box height={3} flexShrink={0} borderStyle="single" borderColor={colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={colors.primary}><b>{`XIRANITE DEV CONTROL | ${snapshot.label}`}</b></text>
        <text fg={phaseColor(snapshot.phase)}><b>{snapshot.phase.toUpperCase()}</b></text>
      </box>

      <box height={3} flexShrink={0} flexDirection="row" gap={1}>
        <Metric label="PID" value={snapshot.pid ? String(snapshot.pid) : "-"} />
        <Metric label="UP" value={uptime} />
        <Metric label="TARGET" value={snapshot.target} />
        <Metric label="OUTPUT" value="native ANSI" />
      </box>

      {exitConfirm ? (
        <box height={3} flexShrink={0} borderStyle="rounded" borderColor={colors.warning} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between" alignItems="center">
          <text fg={colors.warning}><b>Exit stops the managed session.</b></text>
          <box flexDirection="row" gap={1}><InlineAction id="dev-exit-confirm" label="[Q] Confirm" onAction={onExit} /><InlineAction id="dev-exit-cancel" label="[Esc] Back" onAction={() => setExitConfirm(false)} /></box>
        </box>
      ) : (
        <box height={3} flexShrink={0} flexDirection="row" gap={1}>
          <Action id="dev-start" label="Start" keyLabel="S" disabled={snapshot.phase === "running" || snapshot.phase === "starting"} onAction={() => void controller.start()} />
          <Action id="dev-stop" label="Stop" keyLabel="X" disabled={snapshot.phase === "stopped" || snapshot.phase === "stopping"} onAction={() => void controller.stop()} />
          <Action id="dev-restart" label="Restart" keyLabel="R" disabled={snapshot.phase === "starting" || snapshot.phase === "stopping"} onAction={() => void controller.restart()} />
          <Action id="dev-exit" label="Exit" keyLabel="Q" onAction={() => setExitConfirm(true)} />
        </box>
      )}

      <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
        <text fg={colors.muted}>{snapshot.message}</text>
        <text fg={colors.muted}>Native output above | S start | X stop | R restart | Q exit</text>
      </box>
    </box>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <box flexGrow={1} borderStyle="rounded" borderColor={colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between" alignItems="center"><text fg={colors.muted}>{label}</text><text fg={colors.foreground}><b>{value}</b></text></box>
}

function Action({ id, label, keyLabel, disabled = false, onAction }: { id: string; label: string; keyLabel: string; disabled?: boolean; onAction: () => void }) {
  return <box id={id} width={15} height={3} borderStyle="rounded" borderColor={disabled ? colors.border : colors.primary} paddingLeft={1} paddingRight={1} justifyContent="center" onMouseDown={() => { if (!disabled) onAction() }}><text fg={disabled ? colors.muted : colors.foreground}>{`[${keyLabel}] ${label}`}</text></box>
}

function InlineAction({ id, label, onAction }: { id: string; label: string; onAction: () => void }) {
  return <box id={id} width={13} justifyContent="center" onMouseDown={onAction}><text fg={colors.foreground}><b>{label}</b></text></box>
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
  return { target: "dev", label: "XR Browser", phase: "stopped", message: "Ready", ...overrides }
}
