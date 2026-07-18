import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Dissolvef",
  "short": "Dissolve nested, single-media, single-archive, or direct folders with undo history.",
  "description": "Dissolve nested, single-media, single-archive, or direct folders with undo history.",
  "whenToUse": [
    "Use Dissolvef when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Dissolvef from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Dissolvef to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Dissolvef directly from a terminal.",
      "cli": [
        "Run `xiranite dissolvef` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite dissolvef --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite dissolvef",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite dissolvef",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite dissolvef --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help dissolvef",
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
      title: "Dissolvef",
      short: "解套嵌套、单媒体、单归档或直接文件夹，并保留撤销历史。",
      description: "解套嵌套、单媒体、单归档或直接文件夹，并保留撤销历史。",
      whenToUse: [
        "需要从工作区 UI 或 CLI 使用本节点的文件处理流程时使用 Dissolvef。"
      ],
      workflows: [
        {
          title: "工作区 UI",
          summary: "从模块库部署 Dissolvef，并在节点面板上运行。",
          ui: [
            "打开模块库，将 Dissolvef 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，查看结果与日志后再应用真实变更。"
          ]
        },
        {
          title: "CLI",
          summary: "直接在终端运行 Dissolvef。",
          cli: [
            "运行 `xiranite dissolvef` 进入引导模式（当命令支持交互式提示时）。",
            "运行 `xiranite dissolvef --help` 查看该节点命令的具体参数与子命令。"
          ]
        }
      ],
      commands: [
        {
          title: "节点 CLI",
          command: "xiranite dissolvef",
          description: "打开节点 CLI 或查看命令专属参数。",
          examples: [
            {
              label: "引导模式",
              command: "xiranite dissolvef",
              description: "启动该节点的交互式终端流程。"
            },
            {
              label: "命令参数",
              command: "xiranite dissolvef --help",
              description: "查看该节点 CLI 的子命令与选项。"
            },
            {
              label: "共享帮助",
              command: "xiranite help dissolvef",
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
