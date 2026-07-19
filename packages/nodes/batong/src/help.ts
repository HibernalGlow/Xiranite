import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "BATONG",
  short: "Migrate coding-agent sessions used in drawing workflows through Baton.",
  description: "BATONG is a transparent wrapper around the Baton CLI. It preserves Baton command arguments so drawing, illustration, and image-workflow sessions can move between supported coding agents without manually editing transcript files.",
  whenToUse: [
    "Move a Codex, Claude Code, Gemini CLI, OpenCode, Zed, or Aider session that contains drawing-workflow context.",
    "List or diagnose locally available agent sessions before converting them.",
    "Install or remove Baton MCP integration from supported coding agents.",
  ],
  workflows: [
    {
      title: "Session migration",
      summary: "Preview the source session first, then run Baton with its native conversion arguments.",
      cli: [
        "Run `xbatong list` to inspect discovered sessions.",
        "Run `xbatong convert --from codex --to claude --latest` to select the newest Codex session.",
        "Pass a session path to convert a specific drawing-workflow transcript.",
      ],
    },
  ],
  commands: [
    {
      title: "Convert a session",
      command: "xbatong convert --from <agent> --to <agent> [session-file]",
      description: "Forwards the documented Baton conversion command without rewriting its arguments.",
      examples: [
        { label: "Latest Codex session", command: "xbatong convert --from codex --to claude --latest", description: "Convert the latest detected Codex session into Claude Code format." },
        { label: "Specific transcript", command: "xbatong convert --from codex --to claude C:/sessions/drawing.jsonl", description: "Convert one selected drawing-workflow session." },
        { label: "Diagnostics", command: "xbatong doctor", description: "Check Baton installation and detected integrations." },
      ],
    },
  ],
  fields: [
    { name: "from", type: "string", required: true, description: "Baton source-agent format, such as codex or claude." },
    { name: "to", type: "string", required: true, description: "Baton destination-agent format, such as claude or codex." },
    { name: "sessionPath", type: "path", description: "Optional explicit transcript path; omit with --latest to use the newest source session." },
    { name: "extraArgs", type: "string[]", description: "Additional Baton arguments for forward compatibility." },
  ],
  safety: {
    defaultMode: "preview",
    notes: [
      "Run list or doctor before conversion to confirm source and target sessions.",
      "BATONG never interprets or modifies Baton arguments; Baton controls import behavior and target-session writes.",
      "Install the verified @kasabeh/baton-mcp package before using conversion commands.",
    ],
  },
  translations: {
    "zh-CN": {
      title: "BATONG",
      short: "通过 Baton 迁移绘画工作流中的编程代理会话。",
      description: "BATONG 是 Baton CLI 的透明封装。它保留 Baton 原生参数，方便在支持的编程代理之间迁移包含绘画、插画和图像工作流上下文的会话，无需手工编辑转录文件。",
      whenToUse: ["迁移 Codex、Claude Code、Gemini CLI、OpenCode、Zed 或 Aider 中的绘画工作流会话。", "转换前列出或诊断本地代理会话。", "为支持的编程代理安装或移除 Baton MCP 集成。"],
      workflows: [{ title: "会话迁移", summary: "先检查源会话，再用 Baton 原生转换参数执行迁移。", cli: ["运行 `xbatong list` 查看已发现的会话。", "运行 `xbatong convert --from codex --to claude --latest` 选择最新 Codex 会话。", "传入会话路径以转换指定的绘画工作流转录。"] }],
      commands: [{ title: "转换会话", command: "xbatong convert --from <agent> --to <agent> [session-file]", description: "原样转发 Baton 文档中的转换命令。", examples: [{ label: "最新 Codex 会话", command: "xbatong convert --from codex --to claude --latest", description: "将最新检测到的 Codex 会话转换成 Claude Code 格式。" }, { label: "指定转录", command: "xbatong convert --from codex --to claude C:/sessions/drawing.jsonl", description: "转换一份选定的绘画工作流会话。" }, { label: "诊断", command: "xbatong doctor", description: "检查 Baton 安装和已检测集成。" }] }],
      fields: [{ name: "from", type: "string", required: true, description: "Baton 源代理格式，例如 codex 或 claude。" }, { name: "to", type: "string", required: true, description: "Baton 目标代理格式，例如 claude 或 codex。" }, { name: "sessionPath", type: "path", description: "可选的显式转录路径；使用 --latest 时可省略。" }, { name: "extraArgs", type: "string[]", description: "为将来 Baton 功能保留的额外参数。" }],
      safety: { defaultMode: "preview", notes: ["转换前先运行 list 或 doctor，确认源会话和目标会话。", "BATONG 不解释或修改 Baton 参数；导入行为和目标会话写入由 Baton 控制。", "使用转换命令前安装经过验证的 @kasabeh/baton-mcp 包。"] },
    },
  },
} satisfies NodeHelp
