import type { InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import type { NodeRunResult } from "@xiranite/contract"
import type { SoundwAction, SoundwData, SoundwInput } from "./core.js"

export type SoundwInteractionValues = InteractionValues & { action: SoundwAction; profileName: string; soundSwitchPath: string }

const actions: SoundwAction[] = ["status", "switch-recording", "mute", "unmute", "toggle-mute", "profiles", "profile", "settings"]
const labels: Record<"zh" | "en", Record<SoundwAction | "path" | "profileName" | "name" | "description", string>> = {
  zh: { name: "SoundW", description: "快速切换 SoundSwitch 录音设备与麦克风状态。", path: "CLI 路径覆盖", profileName: "预设名称", status: "当前状态", "switch-recording": "切换录音设备", mute: "静音麦克风", unmute: "解除静音", "toggle-mute": "切换静音", profiles: "扫描预设", profile: "激活预设", settings: "打开设置" },
  en: { name: "SoundW", description: "Quickly switch SoundSwitch recording devices and microphone state.", path: "CLI path override", profileName: "Profile name", status: "Current status", "switch-recording": "Switch recording", mute: "Mute microphone", unmute: "Unmute microphone", "toggle-mute": "Toggle mute", profiles: "Scan profiles", profile: "Activate profile", settings: "Open settings" },
}

export function createSoundwInteractionSchema(defaults: Partial<SoundwInteractionValues> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<SoundwInput, NodeRunResult<SoundwData>> {
  const l = labels[language]
  const initialValues: SoundwInteractionValues = { action: "status", profileName: "", soundSwitchPath: "", ...defaults }
  return {
    id: "soundw", title: l.name, description: l.description, initialValues,
    fields: [
      { id: "action", label: language === "zh" ? "操作" : "Action", kind: "select", options: actions.map((value) => ({ value, label: l[value] })) },
      { id: "profileName", label: l.profileName, placeholder: language === "zh" ? "输入或从扫描结果选择" : "Type or select a scanned profile", kind: "text", visibleWhen: (values) => values.action === "profile", validate: (value) => String(value).trim() ? null : language === "zh" ? "请输入预设名称。" : "Enter a profile name." },
      { id: "soundSwitchPath", label: l.path, placeholder: "SoundSwitch.CLI.exe", kind: "text" },
    ],
    toInput: (values) => ({ action: values.action as SoundwAction, profileName: String(values.profileName ?? "").trim() || undefined, soundSwitchPath: String(values.soundSwitchPath ?? "").trim() || undefined }),
    preview: (input) => [l[input.action ?? "status"], input.profileName ? `${l.profileName}: ${input.profileName}` : "", input.soundSwitchPath ? `${l.path}: ${input.soundSwitchPath}` : ""].filter(Boolean),
    isDangerous: () => false,
    result: (result) => ({ success: result.success, message: result.message, lines: result.data?.output ? result.data.output.split(/\r?\n/).slice(0, 8) : [] }),
  }
}

export function soundwActionLabel(action: SoundwAction, language: TerminalLanguage = "zh") { return labels[language][action] }
