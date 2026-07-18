import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "SoundW",
  short: "通过 SoundSwitch 快速查看、切换和静音录音设备。",
  description: "在 GUI、TUI、引导模式或脚本中管理麦克风与 SoundSwitch 预设。",
  whenToUse: ["需要快速切换录音设备、应用预设或切换麦克风静音状态时使用。"],
  workflows: [
    { title: "TUI / GUI", summary: "扫描并选择预设，或直接执行麦克风动作。", ui: ["确认 SoundSwitch.CLI 路径。", "扫描或输入预设名称。", "执行切换、静音或状态查询并查看命令日志。"] },
    { title: "CLI", summary: "适合快捷键、脚本和终端操作。", cli: ["运行 `xsoundw ui` 打开工作台。", "运行 `xsoundw gd` 使用引导模式。", "运行 `xsoundw --help` 查看全部动作。"] },
  ],
  commands: [{ title: "SoundW CLI", command: "xsoundw", description: "打开默认交互模式。", examples: [{ command: "xsoundw ui" }, { command: "xsoundw gd" }, { command: "xsoundw status --json" }] }],
  safety: { defaultMode: "guided", notes: ["设备切换会影响系统当前录音输入。", "状态查询不会修改设备。"] },
  translations: { en: { title: "SoundW", short: "Inspect, switch, and mute recording devices through SoundSwitch.", description: "Manage microphone state and SoundSwitch profiles from GUI, TUI, guided mode, or scripts." } },
} satisfies NodeHelp
