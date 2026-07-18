import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Recycleu",
  "short": "Empty the Windows recycle bin immediately or on a bounded timer.",
  "description": "Empty the Windows recycle bin immediately or on a bounded timer.",
  "whenToUse": [
    "Use Recycleu when you need this node's system workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Recycleu from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Recycleu to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Recycleu directly from a terminal.",
      "cli": [
        "Run `xiranite recycleu` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite recycleu --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite recycleu",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite recycleu",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite recycleu --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help recycleu",
          "description": "Render this shared help entry in the root CLI."
        }
      ]
    }
  ],
  "safety": {
    "defaultMode": "preview",
    "notes": [
      "Review configuration and affected system state before running live actions.",
      "Prefer preview modes when available."
    ]
  },
  "translations": {
    "zh-CN": {
      "title": "Recycleu",
      "short": "立即清空 Windows 回收站，或按有限时长定时清空。",
      "description": "立即清空 Windows 回收站，或按有限时长定时清空。",
      "whenToUse": [
        "需要从工作区 UI 或 CLI 使用此节点的系统工作流时，可使用 Recycleu。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 Recycleu，并在节点面板中运行。",
          "ui": [
            "打开模块库，将 Recycleu 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，查看结果与日志后再实际应用变更。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接在终端中运行 Recycleu。",
          "cli": [
            "当命令支持交互式提示时，运行 `xiranite recycleu` 进入引导模式。",
            "运行 `xiranite recycleu --help` 查看节点命令的具体标志与子命令。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite recycleu",
          "description": "打开节点 CLI 或查看命令专属标志。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xiranite recycleu",
              "description": "启动节点的交互式终端工作流。"
            },
            {
              "label": "命令标志",
              "command": "xiranite recycleu --help",
              "description": "查看节点 CLI 的子命令与选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help recycleu",
              "description": "在根 CLI 中渲染此共享帮助条目。"
            }
          ]
        }
      ],
      "safety": {
        "defaultMode": "preview",
        "notes": [
          "在实际运行前，先检查配置与受影响的系统状态。",
          "可用时优先使用预览模式。"
        ]
      }
    }
  }
} satisfies NodeHelp
