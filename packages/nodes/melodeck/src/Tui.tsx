/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal"
import {
  ClickTarget,
  TerminalImagePreview,
  TerminalSlider,
  TerminalThemeProvider,
  WorkbenchPanel,
  resolveTerminalTheme,
  useAnimation,
  useTerminalChromeActions,
  useTerminalTheme,
  useTerminalUiSession,
} from "@xiranite/cli-runtime/terminal/opentui"
import type { MelodeckAction, MelodeckInput, MelodeckResult } from "./core.js"
import { DEFAULT_MELODECK_IPC, observeMelodeck } from "./platform.js"

interface MelodeckTuiProps extends TerminalUiScreenProps<MelodeckInput, MelodeckResult> {
  observe?: typeof observeMelodeck
}

export function MelodeckTui(props: MelodeckTuiProps) {
  const theme = props.theme ?? props.preferences?.current.theme ?? "nord"
  return (
    <TerminalThemeProvider theme={resolveTerminalTheme(theme === "inherit" ? "nord" : theme)}>
      <MelodeckScreen {...props} />
    </TerminalThemeProvider>
  )
}

function MelodeckScreen({ definition, onExit, observe = observeMelodeck }: MelodeckTuiProps) {
  const theme = useTerminalTheme()
  const session = useTerminalUiSession(definition)
  const frame = useAnimation({ intervalMs: 480 })
  const [liveStatus, setLiveStatus] = useState(session.result?.data?.status)
  const [observerRevision, setObserverRevision] = useState(0)
  const observerActiveRef = useRef(false)
  const resultStatus = session.result?.data?.status
  const ipcPath = String(session.values.ipcPath ?? "").trim() || DEFAULT_MELODECK_IPC
  const status = liveStatus ?? resultStatus
  const configuredPaths = splitPaths(session.values.paths)
  const queue = status?.playlist.length ? status.playlist : configuredPaths
  const stateLabel = status?.running ? (status.paused ? "PAUSED" : "PLAYING") : "READY"
  const stateColor = status?.paused ? theme.colors.warning : status?.running ? theme.colors.success : theme.colors.mutedForeground

  useTerminalChromeActions({ onReset: session.reset, onExit })
  useKeyboard((key) => {
    if (key.name === "escape") onExit()
    if (key.name === "space") void session.requestAction("action", "toggle")
    if (key.name === "n") void session.requestAction("action", "next")
    if (key.name === "p") void session.requestAction("action", "previous")
    if (key.name === "left") void session.requestAction("action", "seek", { seekSeconds: -10 })
    if (key.name === "right") void session.requestAction("action", "seek", { seekSeconds: 10 })
    if (key.name === "up") void session.requestAction("action", "volume", { volume: Math.min(100, (status?.volume ?? Number(session.values.volume ?? 80)) + 5) })
    if (key.name === "down") void session.requestAction("action", "volume", { volume: Math.max(0, (status?.volume ?? Number(session.values.volume ?? 80)) - 5) })
    if (key.name === "c") void session.requestAction("action", "clear")
  })

  useEffect(() => {
    if (!resultStatus) return
    if (resultStatus.running && !observerActiveRef.current) {
      setObserverRevision((revision) => revision + 1)
    }
    setLiveStatus((current) => ({
      ...resultStatus,
      artist: resultStatus.artist || (current?.path === resultStatus.path ? current.artist : ""),
      album: resultStatus.album || (current?.path === resultStatus.path ? current.album : ""),
      artwork: resultStatus.artwork ?? (current?.path === resultStatus.path ? current.artwork : undefined),
    }))
  }, [resultStatus])

  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    observerActiveRef.current = false
    void observe(ipcPath, (next) => {
      if (cancelled) return
      observerActiveRef.current = next.running
      setLiveStatus(next)
    }).then((nextDispose) => {
      if (cancelled) nextDispose()
      else {
        observerActiveRef.current = true
        dispose = nextDispose
      }
    }).catch(() => {
      observerActiveRef.current = false
    })
    return () => {
      cancelled = true
      observerActiveRef.current = false
      dispose?.()
    }
  }, [ipcPath, observe, observerRevision])

  const run = (action: MelodeckAction) => {
    void session.requestAction("action", action)
  }
  const playPath = (path: string) => {
    void session.requestAction("action", "play", { paths: path })
  }
  const seekTo = (position: number) => {
    const offset = position - (status?.position ?? 0)
    if (Math.abs(offset) >= 0.1) void session.requestAction("action", "seek", { seekSeconds: offset })
  }
  const setVolume = (volume: number) => {
    void session.requestAction("action", "volume", { volume })
  }

  return (
    <box width="100%" height="100%" paddingLeft={1} paddingRight={1} flexDirection="column" overflow="hidden">
      <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="column">
          <text fg={theme.colors.primary}><b>MELODECK // LOCAL PLAYER</b></text>
          <text fg={theme.colors.mutedForeground}>mpv IPC | persistent queue | Space pause/resume | P/N tracks</text>
        </box>
        <text fg={stateColor}>{`${stateLabel} ${[".", "o", "O", "o"][frame % 4]}`}</text>
      </box>

      <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}>
        <WorkbenchPanel title={`QUEUE | ${queue.length}`} description="Click a track to replace the active queue" width="42%">
          <scrollbox flexGrow={1}>
            {queue.length ? queue.map((path, index) => (
              <ClickTarget
                key={`${path}-${index}`}
                id={`melodeck-track-${index}`}
                selected={status?.path === path || (!status?.path && index === 0)}
                onClick={() => playPath(path)}
              >
                {`${index + 1}. ${path}`}
              </ClickTarget>
            )) : <text fg={theme.colors.mutedForeground}>Configure saved_tracks or source_path in [nodes.melodeck].</text>}
          </scrollbox>
        </WorkbenchPanel>

        <WorkbenchPanel title="NOW PLAYING" description={status?.paused ? "Paused" : status?.running ? "Local mpv session" : "No active session"} flexGrow={1}>
          <box flexDirection="column">
            <box height={13} flexShrink={0} flexDirection="row" gap={2}>
              <TerminalImagePreview
                source={status?.artwork}
                width={24}
                height={12}
                fit="cover"
                backend="sixel"
                alt={status?.album || status?.title || "Album cover"}
                placeholder="NO COVER"
              />
              <box flexGrow={1} minWidth={0} flexDirection="column" justifyContent="center">
                <text fg={theme.colors.primary}><b>{status?.title || session.resultSummary?.message || "No track selected"}</b></text>
                <text fg={theme.colors.mutedForeground}>{status?.artist || "Unknown artist"}</text>
                <text fg={theme.colors.mutedForeground}>{status?.album || "Unknown album"}</text>
                <text fg={theme.colors.mutedForeground}>{status?.path || "Press Play to start the configured queue."}</text>
              </box>
            </box>
            <box flexGrow={1} />
            <box flexDirection="column" flexShrink={0}>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.colors.mutedForeground}>{formatTime(status?.position ?? 0)}</text>
                <text fg={theme.colors.mutedForeground}>{formatTime(status?.duration ?? 0)}</text>
              </box>
              <TerminalSlider
                id="melodeck-seek"
                value={status?.position ?? 0}
                min={0}
                max={status?.duration && status.duration > 0 ? status.duration : 100}
                step={0.5}
                width="100%"
                foregroundColor={theme.colors.primary}
                backgroundColor={theme.colors.border}
                disabled={!status?.duration}
                onChange={seekTo}
              />
            </box>
            <box height={3} flexShrink={0} flexDirection="row" justifyContent="center" alignItems="center" gap={3}>
              <IconControl id="melodeck-previous" icon="|<" onClick={() => run("previous")} />
              <IconControl
                id="melodeck-play"
                icon={status?.running && !status.paused ? "||" : ">"}
                primary
                onClick={() => run(status?.running ? "toggle" : "play")}
              />
              <IconControl id="melodeck-next" icon=">|" onClick={() => run("next")} />
              <IconControl id="melodeck-stop" icon="[]" onClick={() => run("stop")} />
            </box>
            <box height={1} flexShrink={0} flexDirection="row" justifyContent="center" alignItems="center" gap={1}>
              <text fg={theme.colors.mutedForeground}>VOL</text>
              <TerminalSlider
                id="melodeck-volume"
                value={status?.volume ?? Number(session.values.volume ?? 80)}
                min={0}
                max={100}
                step={1}
                width={18}
                foregroundColor={theme.colors.primary}
                backgroundColor={theme.colors.border}
                onChange={setVolume}
              />
              <text fg={theme.colors.mutedForeground}>{`${Math.round(status?.volume ?? Number(session.values.volume ?? 80))}%`}</text>
            </box>
            <text fg={theme.colors.mutedForeground}>Left/Right seek 10s | Up/Down volume | C clear queue</text>
          </box>
        </WorkbenchPanel>
      </box>
    </box>
  )
}

function IconControl({ id, icon, primary = false, onClick }: { id: string; icon: string; primary?: boolean; onClick(): void }) {
  const theme = useTerminalTheme()
  const [hovered, setHovered] = useState(false)
  return (
    <box
      id={id}
      width={primary ? 7 : 5}
      height={1}
      alignItems="center"
      justifyContent="center"
      onMouseDown={onClick}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <text content={icon} fg={primary || hovered ? theme.colors.primary : theme.colors.mutedForeground} />
    </box>
  )
}

function splitPaths(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n|;/).map((path) => path.trim()).filter(Boolean)
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00"
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
}
