import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "BitV",
  short: "Analyze video bitrate with ffprobe and classify files safely.",
  description: "Native TypeScript bitrate analysis using ffprobe JSON plus file size, with collision-safe copy and move workflows.",
  whenToUse: [
    "Use BitV to inspect bitrate distributions before organizing a video library.",
    "Use report classification to preview or repeat a previously saved analysis.",
  ],
  workflows: [
    {
      title: "Terminal workbench",
      summary: "Use the fullscreen OpenTUI workbench or compact guided flow.",
      cli: [
        "Run `xbitv ui` for the fullscreen mouse-first workbench.",
        "Run `xbitv gd` for the compact guide; `xbitv guided` remains an alias.",
      ],
    },
    {
      title: "Pipe-safe commands",
      summary: "Analyze and classify without interactive prompts or ANSI output.",
      cli: [
        "Run `xbitv analyze <path> --json` to return a machine-readable analysis.",
        "Run `xbitv classify <path> --target <dir> --json` to preview classification.",
        "Add `--apply` only after reviewing planned destination paths.",
      ],
    },
  ],
  commands: [
    {
      title: "Environment status",
      command: "xbitv status --json",
      description: "Check whether ffprobe is available.",
      examples: [],
    },
    {
      title: "Analyze",
      command: "xbitv analyze D:/videos --recursive --output analysis.json --json",
      description: "Scan videos, calculate bitrate from ffprobe duration and file size, and optionally save a report.",
      examples: [],
    },
    {
      title: "Classify",
      command: "xbitv classify D:/videos --target D:/sorted --copy --json",
      description: "Preview collision-safe bitrate directories; add --apply to copy files.",
      examples: [],
    },
    {
      title: "Classify a report",
      command: "xbitv report analysis.json --target D:/sorted --move --json",
      description: "Preview classification from a saved analysis; add --apply for live changes.",
      examples: [],
    },
  ],
  safety: {
    defaultMode: "preview",
    notes: [
      "Classify and report commands default to dry-run.",
      "Copy, move, and report writes never overwrite an existing path; a numbered destination is selected instead.",
    ],
  },
  translations: {
    "zh-CN": {
      title: "BitV",
      short: "使用 ffprobe 分析视频码率并安全分类文件。",
      description: "原生 TypeScript 实现：读取 ffprobe JSON 与文件大小计算码率，并提供防覆盖的复制、移动工作流。",
      whenToUse: [
        "整理视频库前，用 BitV 检查码率分布。",
        "使用报告分类来预演或复用之前保存的分析结果。",
      ],
      workflows: [
        {
          title: "终端工作台",
          summary: "使用全屏 OpenTUI 工作台或紧凑引导流程。",
          cli: [
            "运行 `xbitv ui` 进入全屏鼠标优先工作台。",
            "运行 `xbitv gd` 进入紧凑引导；`xbitv guided` 保留为兼容别名。",
          ],
        },
        {
          title: "管道命令",
          summary: "不启用交互提示或 ANSI 输出，直接分析和分类。",
          cli: [
            "运行 `xbitv analyze <路径> --json` 返回机器可读分析。",
            "运行 `xbitv classify <路径> --target <目录> --json` 预演分类。",
            "确认目标路径后再增加 `--apply`。",
          ],
        },
      ],
      commands: [
        {
          title: "环境状态",
          command: "xbitv status --json",
          description: "检查 ffprobe 是否可用。",
          examples: [],
        },
        {
          title: "分析",
          command: "xbitv analyze D:/videos --recursive --output analysis.json --json",
          description: "扫描视频，根据 ffprobe 时长与文件大小计算码率，并可选保存报告。",
          examples: [],
        },
        {
          title: "分类",
          command: "xbitv classify D:/videos --target D:/sorted --copy --json",
          description: "预演防覆盖的码率目录；增加 --apply 后才复制文件。",
          examples: [],
        },
        {
          title: "按报告分类",
          command: "xbitv report analysis.json --target D:/sorted --move --json",
          description: "根据已有报告预演分类；增加 --apply 后才真实移动。",
          examples: [],
        },
      ],
      safety: {
        defaultMode: "preview",
        notes: [
          "classify 与 report 默认使用 dry-run。",
          "复制、移动和报告写入都不会覆盖已有路径，而是自动选择带编号的新路径。",
        ],
      },
    },
  },
} satisfies NodeHelp
