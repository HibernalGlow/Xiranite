import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "TransQ",
  short: "Organize manga-translator result queues with native filesystem operations.",
  description: "Find completed manga-translator workspaces, restore mapped originals missing from result folders, and move finished results into their final location.",
  whenToUse: [
    "Use TransQ after manga-translator has produced an original_images/manga_translator_work/result folder.",
    "Preview first when you need to identify missing mapped files or output-folder conflicts before changing the workspace.",
  ],
  workflows: [
    {
      title: "Workspace UI",
      summary: "Preview translation queues, then confirm the queues that are safe to organize.",
      ui: [
        "Add one or more translation project roots; TransQ scans their nested original_images workspaces recursively.",
        "Review the Needs copy, Ready, Output, and Conflict lanes.",
        "Keep Preview enabled for inspection. Disable it only when the queue is ready, then confirm the organize action.",
      ],
    },
    {
      title: "CLI",
      summary: "Plan or organize translation queues directly from a terminal.",
      cli: [
        "Run `xiranite transq plan D:/translation/project` to inspect queues without changing files.",
        "Run `xiranite transq run D:/translation/project --live` to apply a reviewed queue.",
        "Pass `-` as the path to read project roots from stdin.",
      ],
    },
  ],
  commands: [
    {
      title: "Preview queues",
      command: "xiranite transq plan <path>",
      description: "Scan workspaces and report copies, outputs, missing files, and conflicts without changing files.",
      examples: [
        {
          label: "Preview one project",
          command: "xiranite transq plan D:/translation/project",
        },
        {
          label: "Preview paths from stdin",
          command: "Get-Content projects.txt | xiranite transq plan -",
        },
      ],
    },
    {
      title: "Organize queues",
      command: "xiranite transq run <path> --live",
      description: "Copy mapped originals missing from result, remove translator work artifacts, move result, and remove the completed original_images folder.",
      examples: [
        {
          label: "Apply a reviewed queue",
          command: "xiranite transq run D:/translation/project --live",
        },
      ],
    },
  ],
  safety: {
    defaultMode: "preview",
    destructive: [
      "Live mode removes translator work artifacts and the completed original_images folder after the result directory has moved successfully.",
      "An existing output result folder is treated as a conflict and is never overwritten automatically.",
    ],
    notes: [
      "Preview the same project immediately before a live run.",
      "Keep a backup when processing translation projects that cannot be regenerated.",
    ],
  },
  translations: {
    "zh-CN": {
      title: "TransQ",
      short: "使用原生文件系统操作整理漫画翻译结果队列。",
      description: "查找已完成的 manga-translator 工作区，补齐结果目录缺失的映射原图，并将完成结果移动到最终位置。",
      whenToUse: [
        "当 manga-translator 已生成 original_images/manga_translator_work/result 时使用 TransQ。",
        "需要在改动工作区前检查映射文件缺失或输出目录冲突时，先运行预演。",
      ],
      workflows: [
        {
          title: "工作区 UI",
          summary: "先预演翻译队列，再确认整理安全的队列。",
          ui: [
            "添加一个或多个翻译项目根目录；TransQ 会递归扫描其中的 original_images 工作区。",
            "检查待补齐、可整理、已输出和冲突四条泳道。",
            "检查阶段保持预演开启；确认队列无误后关闭预演，再确认整理操作。",
          ],
        },
        {
          title: "CLI",
          summary: "从终端直接规划或整理翻译队列。",
          cli: [
            "运行 `xiranite transq plan D:/translation/project` 检查队列，不改动文件。",
            "运行 `xiranite transq run D:/translation/project --live` 应用已检查的队列。",
            "路径使用 `-` 时可从标准输入读取项目根目录。",
          ],
        },
      ],
      commands: [
        {
          title: "预演队列",
          command: "xiranite transq plan <path>",
          description: "扫描工作区并报告待复制项、输出位置、缺失文件和冲突，不改动文件。",
          examples: [
            {
              label: "预演一个项目",
              command: "xiranite transq plan D:/translation/project",
            },
            {
              label: "从标准输入预演",
              command: "Get-Content projects.txt | xiranite transq plan -",
            },
          ],
        },
        {
          title: "整理队列",
          command: "xiranite transq run <path> --live",
          description: "补齐结果目录缺失的映射原图，清理翻译工作文件，移动 result，并删除已完成的 original_images。",
          examples: [
            {
              label: "应用已检查队列",
              command: "xiranite transq run D:/translation/project --live",
            },
          ],
        },
      ],
      safety: {
        defaultMode: "preview",
        destructive: [
          "真实执行会在结果目录成功移动后删除翻译工作文件和已完成的 original_images 目录。",
          "目标 result 已存在时会标记为冲突，绝不会自动覆盖。",
        ],
        notes: [
          "真实执行前立即对同一项目再预演一次。",
          "处理无法重新生成的翻译项目时请保留备份。",
        ],
      },
    },
  },
} satisfies NodeHelp
