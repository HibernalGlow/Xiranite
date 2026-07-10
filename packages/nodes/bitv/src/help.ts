import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "BitV",
  "short": "Analyze and classify video bitrate with PackU BitV.",
  "description": "Analyze and classify video bitrate with PackU BitV.",
  "whenToUse": [
    "Use BitV when you need this node's video workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy BitV from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy BitV to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run BitV directly from a terminal.",
      "cli": [
        "Run `xiranite bitv` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite bitv --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite bitv",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite bitv",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite bitv --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help bitv",
          "description": "Render this shared help entry in the root CLI."
        }
      ]
    }
  ],
  "safety": {
    "defaultMode": "preview",
    "notes": [
      "Prefer preview or dry-run modes before changing files.",
      "Keep backups or undo records when processing large folders."
    ]
  },
  translations: {
    "zh-CN": {
      title: "BitV",
      short: "通过 PackU BitV 分析并分类视频码率。",
      description: "通过 PackU BitV 分析并分类视频码率。",
      whenToUse: [
        "需要从工作区 UI 或 CLI 使用本节点的视频处理流程时使用 BitV。"
      ],
      workflows: [
        {
          title: "工作区 UI",
          summary: "从模块库部署 BitV，并在节点面板上运行。",
          ui: [
            "打开模块库，将 BitV 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，查看结果与日志后再应用真实变更。"
          ]
        },
        {
          title: "CLI",
          summary: "直接在终端运行 BitV。",
          cli: [
            "运行 `xiranite bitv` 进入引导模式（当命令支持交互式提示时）。",
            "运行 `xiranite bitv --help` 查看该节点命令的具体参数与子命令。"
          ]
        }
      ],
      commands: [
        {
          title: "节点 CLI",
          command: "xiranite bitv",
          description: "打开节点 CLI 或查看命令专属参数。",
          examples: [
            {
              label: "引导模式",
              command: "xiranite bitv",
              description: "启动该节点的交互式终端流程。"
            },
            {
              label: "命令参数",
              command: "xiranite bitv --help",
              description: "查看该节点 CLI 的子命令与选项。"
            },
            {
              label: "共享帮助",
              command: "xiranite help bitv",
              description: "在根 CLI 中渲染本条共享帮助条目。"
            }
          ]
        }
      ],
      safety: {
        defaultMode: "preview",
        notes: [
          "改动文件前优先使用预览或 dry-run 模式。",
          "处理大型文件夹时请保留备份或撤销记录。"
        ]
      }
    },
  },
} satisfies NodeHelp
