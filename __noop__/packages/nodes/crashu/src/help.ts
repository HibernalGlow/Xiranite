import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Crashu",
  "short": "Match similar folder names and optionally move matched folders.",
  "description": "Match similar folder names and optionally move matched folders.",
  "whenToUse": [
    "Use Crashu when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Crashu from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Crashu to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Crashu directly from a terminal.",
      "cli": [
        "Run `xiranite crashu` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite crashu --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite crashu",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite crashu",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite crashu --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help crashu",
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
      title: "Crashu",
      short: "匹配相似文件夹名称，并可选地移动匹配到的文件夹。",
      description: "匹配相似文件夹名称，并可选地移动匹配到的文件夹。",
      whenToUse: [
        "需要从工作区 UI 或 CLI 使用本节点的文件处理流程时使用 Crashu。"
      ],
      workflows: [
        {
          title: "工作区 UI",
          summary: "从模块库部署 Crashu，并在节点面板上运行。",
          ui: [
            "打开模块库，将 Crashu 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，查看结果与日志后再应用真实变更。"
          ]
        },
        {
          title: "CLI",
          summary: "直接在终端运行 Crashu。",
          cli: [
            "运行 `xiranite crashu` 进入引导模式（当命令支持交互式提示时）。",
            "运行 `xiranite crashu --help` 查看该节点命令的具体参数与子命令。"
          ]
        }
      ],
      commands: [
        {
          title: "节点 CLI",
          command: "xiranite crashu",
          description: "打开节点 CLI 或查看命令专属参数。",
          examples: [
            {
              label: "引导模式",
              command: "xiranite crashu",
              description: "启动该节点的交互式终端流程。"
            },
            {
              label: "命令参数",
              command: "xiranite crashu --help",
              description: "查看该节点 CLI 的子命令与选项。"
            },
            {
              label: "共享帮助",
              command: "xiranite help crashu",
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
