import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "FormatV",
  "short": "Scan video folders, add/remove .nov suffixes, and check prefixed duplicates.",
  "description": "Scan video folders, add/remove .nov suffixes, and check prefixed duplicates.",
  "whenToUse": [
    "Use FormatV when you need this node's video workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy FormatV from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy FormatV to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run FormatV directly from a terminal.",
      "cli": [
        "Run `xiranite formatv` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite formatv --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite formatv",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite formatv",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite formatv --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help formatv",
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
      "title": "FormatV",
      "short": "扫描视频文件夹，添加/移除 .nov 后缀，并检查带前缀的重复项。",
      "description": "扫描视频文件夹，添加/移除 .nov 后缀，并检查带前缀的重复项。",
      "whenToUse": [
        "需要在工作区 UI 或 CLI 中使用该节点的视频工作流时，使用 FormatV。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 FormatV，并在节点面板上运行。",
          "ui": [
            "打开模块库，将 FormatV 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，再检查结果与日志，最后才应用真实变更。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接从终端运行 FormatV。",
          "cli": [
            "命令支持交互提示时，运行 `xiranite formatv` 进入引导模式。",
            "运行 `xiranite formatv --help` 查看该节点命令的具体参数与子命令。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite formatv",
          "description": "打开节点 CLI 或查看命令专属参数。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xiranite formatv",
              "description": "启动该节点的交互式终端流程。"
            },
            {
              "label": "命令参数",
              "command": "xiranite formatv --help",
              "description": "显示该节点 CLI 的子命令与选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help formatv",
              "description": "在根 CLI 中渲染该共享帮助条目。"
            }
          ]
        }
      ],
      "safety": {
        "defaultMode": "preview",
        "notes": [
          "在修改文件前，优先使用预览或 dry-run 模式。",
          "处理大文件夹时请保留备份或撤销记录。"
        ]
      }
    }
  }
} satisfies NodeHelp
