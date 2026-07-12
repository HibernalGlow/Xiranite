import { useEffect, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { SoundwAction, SoundwData, SoundwInput } from "@xiranite/node-soundw/core"
import { AudioLines, Cable, ChevronDown, ChevronUp, ListRestart, Mic, MicOff, RefreshCw, Settings, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"

type SoundwCardState = {
  profileName?: string
  soundSwitchPath?: string
  showAdvanced?: boolean
  result?: SoundwData | null
  logs?: string[]
}
type SoundwDefaults = Pick<SoundwCardState, "profileName" | "soundSwitchPath">

const MAX_LOG_LINES = 60

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useNodeI18n("soundw")
  const data = host.getData<SoundwCardState>(compId) ?? {}
  const dataRef = useRef(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<SoundwDefaults | undefined>()

  useEffect(() => {
    host.getNodeConfig?.<SoundwDefaults>().then((response) => setDefaults(response.config)).catch(() => undefined)
  }, [host])

  function patch(next: Partial<SoundwCardState>) {
    dataRef.current = { ...dataRef.current, ...next }
    host.patchData(compId, next)
  }

  function appendLog(message: string) {
    patch({ logs: [...(dataRef.current.logs ?? []), message].slice(-MAX_LOG_LINES) })
  }

  async function execute(action: SoundwAction) {
    const run = host.actions?.run
    if (running || !run) {
      if (!run) appendLog("Native action is unavailable in this host.")
      return
    }

    setRunning(true)
    try {
      const response = await run<SoundwInput, SoundwData>("soundw", {
        action,
        soundSwitchPath: dataRef.current.soundSwitchPath ?? defaults?.soundSwitchPath,
        profileName: dataRef.current.profileName ?? defaults?.profileName,
      }, (event) => appendLog(`[${event.progress ?? 0}%] ${event.message}`)) as NodeRunResult<SoundwData>

      patch({
        result: response.data ?? null,
        logs: [...(dataRef.current.logs ?? []), response.message].slice(-MAX_LOG_LINES),
      })
    } catch (error) {
      appendLog(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  const result = data.result
  const statusText = result?.muteState === null || result?.muteState === undefined
    ? t("status.notQueried", "状态未查询")
    : result.muteState
  const lastOutput = result?.output || t("status.ready", "就绪 — 查询状态或切换录音设备。")
  const profileName = data.profileName ?? defaults?.profileName ?? ""
  const soundSwitchPath = data.soundSwitchPath ?? defaults?.soundSwitchPath ?? ""
  const configDirty = defaults !== undefined && (profileName !== (defaults.profileName ?? "") || soundSwitchPath !== (defaults.soundSwitchPath ?? ""))
  async function saveDefaults() {
    const next = { profileName: profileName || undefined, soundSwitchPath: soundSwitchPath || undefined }
    await host.saveNodeConfig?.(next)
    setDefaults(next)
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-muted/20 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/35 bg-primary/5 text-primary">
            <Mic className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-medium tracking-[0.16em] text-muted-foreground">{t("labels.soundswitchRecording", "SOUNDSWITCH / RECORDING")}</p>
            <p className="truncate text-sm font-semibold" title={lastOutput}>{lastOutput}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border px-2 py-1 font-mono text-[10px] text-muted-foreground">{t("labels.micPrefix", "MIC")}: {statusText}</span>
          <Button aria-label={t("aria.refreshStatus", "刷新麦克风状态")} disabled={running} onClick={() => execute("status")} size="icon-sm" variant="ghost">
            <RefreshCw className={running ? "animate-spin" : undefined} />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(13rem,.9fr)_minmax(16rem,1.15fr)_minmax(12rem,.8fr)]">
        <section className="rounded-xl border bg-muted/15 p-3">
          <div className="mb-3 flex items-center justify-between border-b pb-2">
            <div>
              <p className="font-semibold">{t("sections.deviceMatrix", "设备矩阵")}</p>
              <p className="font-mono text-[10px] tracking-widest text-primary">{t("labels.recordingRoute", "录音路由")}</p>
            </div>
            <Cable className="size-4 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary"><Mic className="size-4" /></span>
                <div className="min-w-0"><p className="text-sm font-medium">{t("labels.recordingDevices", "录音设备")}</p><p className="mt-0.5 text-xs text-muted-foreground">{t("descriptions.recordingDevices", "仅循环切换 SoundSwitch 中配置的输入设备。")}</p></div>
              </div>
              <Button className="mt-3 w-full gap-1.5" disabled={running} onClick={() => execute("switch-recording")} size="sm">
                <ListRestart className="size-3.5" /> {t("actions.switchRecordingDevice", "切换录音设备")}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button className="h-auto min-h-16 flex-col gap-1.5" disabled={running} onClick={() => execute("mute")} size="sm" variant="outline"><MicOff className="size-4" />{t("actions.muteMic", "静音麦克风")}</Button>
              <Button className="h-auto min-h-16 flex-col gap-1.5" disabled={running} onClick={() => execute("unmute")} size="sm" variant="outline"><Volume2 className="size-4" />{t("actions.unmuteMic", "取消静音")}</Button>
            </div>
            <Button className="w-full gap-1.5" disabled={running} onClick={() => execute("toggle-mute")} size="sm" variant="ghost"><AudioLines className="size-3.5" />{t("actions.toggleMute", "切换麦克风静音")}</Button>
          </div>
        </section>

        <section className="min-h-0 rounded-xl border bg-muted/15 p-3">
          <div className="mb-3 flex items-center justify-between border-b pb-2">
            <div><p className="font-semibold">{t("sections.profileHub", "配置中心")}</p><p className="font-mono text-[10px] tracking-widest text-primary">{t("labels.soundswitchProfiles", "SOUNDSWITCH 配置")}</p></div>
            <Button aria-label={t("aria.loadProfiles", "加载 SoundSwitch 配置")} disabled={running} onClick={() => execute("profiles")} size="icon-sm" variant="ghost"><RefreshCw className={running ? "animate-spin" : undefined} /></Button>
          </div>
          <div className="flex gap-2">
            <Input aria-label={t("aria.profileName", "SoundSwitch 配置名称")} disabled={running} onChange={(event) => patch({ profileName: event.target.value })} placeholder={t("placeholders.profileName", "配置名称")} value={profileName} />
            <Button disabled={running || !profileName.trim()} onClick={() => execute("profile")} size="sm">{t("actions.activate", "激活")}</Button>
          </div>
          <ScrollArea className="mt-3 h-[calc(100%-5.5rem)] min-h-24 rounded-lg border bg-background/35">
            <div className="space-y-1.5 p-2">
              {result?.profiles.length ? result.profiles.map((profile) => (
                <button className="flex w-full items-center justify-between rounded-md border bg-muted/20 px-2.5 py-2 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/5" key={profile} onClick={() => patch({ profileName: profile })} type="button">
                  <span className="truncate font-mono">{profile}</span><span className="text-[10px] text-muted-foreground">{t("labels.use", "使用")}</span>
                </button>
              )) : <p className="px-2 py-5 text-center text-xs text-muted-foreground">{t("empty.profiles", "加载配置以选择。配置定义仍由 SoundSwitch 管理。")}</p>}
            </div>
          </ScrollArea>
        </section>

        <section className="flex min-h-0 flex-col rounded-xl border bg-muted/15 p-3">
          <div className="flex items-center justify-between border-b pb-2"><div><p className="font-semibold">{t("sections.consoleLog", "控制台日志")}</p><p className="font-mono text-[10px] tracking-widest text-primary">{t("labels.commandOutput", "命令输出")}</p></div><Button aria-label={t("aria.openSettings", "打开 SoundSwitch 设置")} disabled={running} onClick={() => execute("settings")} size="icon-sm" variant="ghost"><Settings /></Button></div>
          <ScrollArea className="mt-3 min-h-20 flex-1 rounded-lg border bg-background/60">
            <div className="space-y-1 p-2 font-mono text-[10px] leading-5 text-muted-foreground">{(data.logs ?? []).length ? (data.logs ?? []).map((line, index) => <p key={`${line}-${index}`} className="break-words">{line}</p>) : <p>{t("empty.logs", "尚未运行命令。")}</p>}</div>
          </ScrollArea>
          <div className="mt-3 border-t pt-2">
            <Button className="h-6 w-full justify-between px-1.5 text-[10px]" onClick={() => patch({ showAdvanced: !data.showAdvanced })} size="sm" variant="ghost">{t("advanced.cliOverride", "CLI 路径覆盖")} {data.showAdvanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}</Button>
            {data.showAdvanced && <Input className="mt-2 h-8 font-mono text-xs" onChange={(event) => patch({ soundSwitchPath: event.target.value })} placeholder={t("placeholders.cliPath", "SoundSwitch.CLI.exe 路径")} value={soundSwitchPath} />}
            {configDirty && <Button className="mt-2 w-full" onClick={saveDefaults} size="sm" variant="outline">{t("actions.saveDefaults", "保存为默认")}</Button>}
          </div>
        </section>
      </div>
    </div>
  )
}
