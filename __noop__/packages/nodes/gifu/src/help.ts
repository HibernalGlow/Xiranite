import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Gifu",
  "short": "Convert image archives to GIF, WebP, APNG, WebM, or MP4 with the native media runtime.",
  "description": "Inspect and plan archives in TypeScript, then use 7-Zip and ffmpeg for native conversion.",
  "whenToUse": [
    "Use Gifu when you need this node's image workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Gifu from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Gifu to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Gifu directly from a terminal.",
      "cli": [
        "Run `xgifu ui` for the full OpenTUI workbench or `xgifu gd` for the compact guide.",
        "Use `xgifu inspect`, `xgifu plan`, and `xgifu make` for pipeline-safe commands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite gifu",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xgifu gd",
          "description": "Start the compact guided terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xgifu --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help gifu",
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
      "title": "Gifu",
      "short": "使用原生媒体运行时，将图片归档转换为 GIF、WebP、APNG、WebM 或 MP4。",
      "description": "使用 TypeScript 检查与规划归档，再由 7-Zip 和 ffmpeg 完成本地转换。",
      "whenToUse": [
        "需要在工作区 UI 或 CLI 中使用该节点的图像工作流时，使用 Gifu。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 Gifu，并在节点面板上运行。",
          "ui": [
            "打开模块库，将 Gifu 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，再检查结果与日志，最后才应用真实变更。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接从终端运行 Gifu。",
          "cli": [
            "运行 `xgifu ui` 打开 OpenTUI 工作台，或运行 `xgifu gd` 进入精简引导。",
            "脚本使用 `xgifu inspect`、`xgifu plan` 与 `xgifu make`。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite gifu",
          "description": "打开节点 CLI 或查看命令专属参数。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xgifu gd",
              "description": "启动该节点的交互式终端流程。"
            },
            {
              "label": "命令参数",
              "command": "xgifu --help",
              "description": "显示该节点 CLI 的子命令与选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help gifu",
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
