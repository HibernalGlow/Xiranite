import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Owithu",
  "short": "Preview, register, and unregister Windows Open-with context menu entries from TOML.",
  "description": "Preview, register, and unregister Windows Open-with context menu entries from TOML.",
  "whenToUse": [
    "Use Owithu when you need this node's system workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Owithu from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Owithu to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Owithu directly from a terminal.",
      "cli": [
        "Run `xiranite owithu` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite owithu --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite owithu",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite owithu",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite owithu --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help owithu",
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
      "title": "Owithu",
      "short": "预览、注册和注销 Windows Open-with 右键菜单项（基于 TOML 配置）。",
      "description": "预览、注册和注销 Windows Open-with 右键菜单项（基于 TOML 配置）。",
      "whenToUse": [
        "需要从工作区 UI 或 CLI 使用此节点的系统工作流时，可使用 Owithu。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 Owithu，并在节点面板中运行。",
          "ui": [
            "打开模块库，将 Owithu 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，查看结果与日志后再实际应用变更。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接在终端中运行 Owithu。",
          "cli": [
            "当命令支持交互式提示时，运行 `xiranite owithu` 进入引导模式。",
            "运行 `xiranite owithu --help` 查看节点命令的具体标志与子命令。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite owithu",
          "description": "打开节点 CLI 或查看命令专属标志。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xiranite owithu",
              "description": "启动节点的交互式终端工作流。"
            },
            {
              "label": "命令标志",
              "command": "xiranite owithu --help",
              "description": "查看节点 CLI 的子命令与选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help owithu",
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
