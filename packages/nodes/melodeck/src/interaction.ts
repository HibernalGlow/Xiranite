import type { InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import type { MelodeckAction, MelodeckInput, MelodeckResult } from "./core.js"

type Values = InteractionValues & { action: MelodeckAction; paths: string; volume: number; mpvPath: string; ipcPath: string }
export function createMelodeckInteractionSchema(defaults: Partial<Values> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<MelodeckInput, MelodeckResult> {
  const zh = language === "zh"
  const initialValues: Values = { action: "status", paths: "", volume: 80, mpvPath: "", ipcPath: "", ...defaults }
  const labels: Record<MelodeckAction, string> = { status: zh ? "状态" : "Status", play: zh ? "播放" : "Play", pause: zh ? "暂停" : "Pause", toggle: zh ? "切换播放" : "Toggle", stop: zh ? "停止" : "Stop", next: zh ? "下一首" : "Next", previous: zh ? "上一首" : "Previous", add: zh ? "加入队列" : "Add", clear: zh ? "清空队列" : "Clear" }
  return { id: "melodeck", title: "Melodeck", description: zh ? "基于 mpv 的本地音乐播放台" : "Local music deck backed by mpv", initialValues, fields: [
    { id: "action", label: zh ? "操作" : "Action", kind: "select", options: (Object.keys(labels) as MelodeckAction[]).map((value) => ({ value, label: labels[value] })) },
    { id: "paths", label: zh ? "音乐队列" : "Music queue", kind: "path-list", lines: 5 },
    { id: "volume", label: zh ? "音量" : "Volume", kind: "number", min: 0, max: 100, step: 5 },
    { id: "mpvPath", label: "mpv", kind: "text", placeholder: "mpv.exe" },
    { id: "ipcPath", label: "IPC", kind: "text", placeholder: "optional; defaults to Melodeck pipe" },
  ], toInput: (values) => ({ action: values.action as MelodeckAction, paths: String(values.paths ?? "").split(/[\r\n;]+/).filter(Boolean), volume: Number(values.volume ?? 80), mpvPath: String(values.mpvPath ?? "").trim() || undefined, ipcPath: String(values.ipcPath ?? "").trim() || undefined }), validate: (_values, input) => (input.action === "play" && !input.paths?.length ? (zh ? "至少输入一个音频文件。" : "Provide at least one audio file.") : null), preview: (input) => [`${labels[input.action ?? "status"]}`, `${input.paths?.length ?? 0} track(s)`, `Volume ${input.volume ?? 80}%`], isDangerous: () => false, result: (result) => ({ success: result.success, message: result.message, lines: result.data ? [result.data.status.title || "Melodeck", ...result.data.status.playlist.slice(0, 5)] : [] }) }
}
