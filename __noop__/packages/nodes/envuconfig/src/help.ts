import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "EnvU Config",
  "short": "Inventory, record, and back up EnvU installation configuration files.",
  "description": "Inventory, record, and back up EnvU installation configuration files.",
  "whenToUse": [
    "Use EnvU Config when you need this node's system workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy EnvU Config from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy EnvU Config to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run EnvU Config directly from a terminal.",
      "cli": [
        "Run `xiranite envuconfig` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite envuconfig --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite envuconfig",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite envuconfig",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite envuconfig --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help envuconfig",
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
  translations: {
    "zh-CN": {
      "title": "EnvU Config",
      "short": "盘点、记录并备份 EnvU 安装配置文件。",
      "description": "盘点、记录并备份 EnvU 安装配置文件。",
      "whenToUse": [
        "需要在工作区 UI 或 CLI 中使用该节点的系统工作流时，使用 EnvU Config。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 EnvU Config，并在节点面板上运行。",
          "ui": [
            "打开模块库，将 EnvU Config 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，再检查结果与日志，最后才应用真实变更。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接从终端运行 EnvU Config。",
          "cli": [
            "命令支持交互提示时，运行 `xiranite envuconfig` 进入引导模式。",
            "运行 `xiranite envuconfig --help` 查看该节点命令的具体参数与子命令。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite envuconfig",
          "description": "打开节点 CLI 或查看命令专属参数。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xiranite envuconfig",
              "description": "启动该节点的交互式终端流程。"
            },
            {
              "label": "命令参数",
              "command": "xiranite envuconfig --help",
              "description": "显示该节点 CLI 的子命令与选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help envuconfig",
              "description": "在根 CLI 中渲染该共享帮助条目。"
            }
          ]
        }
      ],
      "safety": {
        "defaultMode": "preview",
        "notes": [
          "执行真实操作前，请先核对配置与受影响的系统状态。",
          "可用时优先使用预览模式。"
        ]
      }
    }
  }
} satisfies NodeHelp
