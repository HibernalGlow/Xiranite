import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "Cleanf",
  short: "Preview and remove empty folders, backup files, temp folders, trash files, and cleanup presets.",
  description: "Cleanf scans folders, plans cleanup targets by preset, previews the affected paths, and can execute removal through the local runtime.",
  whenToUse: [
    "Clean generated folders after image, archive, or video processing batches.",
    "Remove known temporary files such as .bak, .trash, temp_ folders, [#hb] text files, or log/upscale leftovers.",
    "Run the same cleanup preset from the workspace UI and from terminal automation.",
  ],
  workflows: [
    {
      title: "Workspace UI",
      summary: "Use the UI when you want to see target counts and logs before deleting anything.",
      ui: [
        "Deploy Cleanf from the module registry.",
        "Paste one or more folder paths and choose cleanup presets.",
        "Run preview first, inspect the listed targets, then switch to live execution only after the plan looks correct.",
      ],
      tips: [
        "Use exclude keywords for folders or files that must never be removed.",
        "Start with the default preset set before enabling log_files or upscale.",
      ],
    },
    {
      title: "Guided CLI",
      summary: "Use guided mode for clipboard-driven cleanup with confirmation prompts.",
      cli: [
        "Copy one or more folder paths to the clipboard.",
        "Run `xiranite cleanf` and choose the clipboard path source.",
        "Select a preset combination, preview targets, then confirm live deletion only when the target list is correct.",
      ],
    },
    {
      title: "Scripted CLI",
      summary: "Use explicit commands for repeatable cleanup jobs.",
      cli: [
        "Run `xiranite cleanf preview --paths \"D:/work/a;D:/work/b\" --presets empty_folders,backup_files` to inspect targets.",
        "Run `xiranite cleanf run --paths \"D:/work/a\" --presets empty_folders,backup_files --preview false` when the preview is safe.",
        "Add `--json` when another script needs structured result data.",
      ],
    },
  ],
  commands: [
    {
      title: "Preview cleanup",
      command: "xiranite cleanf preview",
      description: "Scan paths and print the cleanup plan without deleting files.",
      examples: [
        {
          label: "Guided mode",
          command: "xiranite cleanf",
          description: "Open the interactive cleanup workflow with clipboard path detection.",
        },
        {
          label: "Preview default cleanup",
          command: "xiranite cleanf preview --paths \"D:/downloads/a;D:/downloads/b\"",
          description: "Preview default cleanup presets across multiple folders.",
        },
        {
          label: "Preview as JSON",
          command: "xiranite cleanf preview --paths \"D:/downloads/a\" --json",
          description: "Return target counts and preview file paths as JSON.",
        },
      ],
    },
    {
      title: "Run cleanup",
      command: "xiranite cleanf run",
      description: "Execute the selected cleanup presets.",
      examples: [
        {
          label: "Run selected presets",
          command: "xiranite cleanf run --paths \"D:/downloads/a\" --presets empty_folders,backup_files,temp_folders --preview false",
          description: "Delete targets found by the selected presets.",
        },
      ],
    },
  ],
  fields: [
    {
      name: "paths",
      type: "string[]",
      required: true,
      description: "Folders to scan for cleanup targets.",
    },
    {
      name: "presets",
      type: "CleanfPresetId[]",
      description: "Cleanup presets such as empty_folders, backup_files, temp_folders, trash_files, hb_txt_files, log_files, or upscale.",
      defaultValue: "enabled defaults",
    },
    {
      name: "exclude",
      type: "string",
      description: "Comma-separated keywords. Matching paths are skipped.",
    },
    {
      name: "preview",
      type: "boolean",
      description: "When true, scan and report targets without deletion.",
      defaultValue: "true",
    },
  ],
  safety: {
    defaultMode: "preview",
    destructive: [
      "run with preview=false removes files and folders from disk.",
      "Preset combinations complete and upscale include broader cleanup rules.",
    ],
    notes: [
      "Always run preview before live cleanup on a new folder tree.",
      "Use exclude keywords for archive roots, source folders, or project folders that should be preserved.",
    ],
  },
  translations: {
    "zh-CN": {
      title: "Cleanf",
      short: "预览并清理空文件夹、备份文件、临时文件夹、垃圾文件和常用清理预设。",
      description: "Cleanf 会扫描文件夹，按预设规划待清理目标，先展示受影响路径，再通过本地运行时执行删除。",
      whenToUse: [
        "图片、归档或视频批处理后，需要清理生成目录里的临时残留。",
        "需要删除 .bak、.trash、temp_ 文件夹、[#hb] 文本、日志或 upscale 缓存等已知垃圾项。",
        "同一套清理预设既要在工作区 UI 里用，也要能放进终端自动化。",
      ],
      workflows: [
        {
          title: "工作区 UI",
          summary: "想在删除前看到目标数量和日志时，优先使用 UI。",
          ui: [
            "从模块库部署 Cleanf。",
            "粘贴一个或多个文件夹路径，并选择清理预设。",
            "先运行预览，确认目标列表无误后，再切换到真实执行。",
          ],
          tips: [
            "用排除关键词保护不能被删除的文件夹或文件。",
            "先使用默认预设，再谨慎开启 log_files 或 upscale。",
          ],
        },
        {
          title: "引导式 CLI",
          summary: "适合从剪贴板读取路径，并逐步确认清理动作。",
          cli: [
            "复制一个或多个文件夹路径到剪贴板。",
            "运行 `xiranite cleanf`，选择剪贴板路径来源。",
            "选择预设组合，先预览目标，再确认是否真实删除。",
          ],
        },
        {
          title: "脚本式 CLI",
          summary: "适合可重复的清理任务。",
          cli: [
            "运行 `xiranite cleanf preview --paths \"D:/work/a;D:/work/b\" --presets empty_folders,backup_files` 查看目标。",
            "预览安全后，运行 `xiranite cleanf run --paths \"D:/work/a\" --presets empty_folders,backup_files --preview false`。",
            "需要给其他脚本消费结果时，加上 `--json`。",
          ],
        },
      ],
      commands: [
        {
          title: "预览清理",
          command: "xiranite cleanf preview",
          description: "扫描路径并打印清理计划，不删除文件。",
          examples: [
            {
              label: "引导模式",
              command: "xiranite cleanf",
              description: "打开交互式清理流程，并自动检测剪贴板路径。",
            },
            {
              label: "预览默认清理",
              command: "xiranite cleanf preview --paths \"D:/downloads/a;D:/downloads/b\"",
              description: "对多个文件夹预览默认清理预设。",
            },
            {
              label: "JSON 预览",
              command: "xiranite cleanf preview --paths \"D:/downloads/a\" --json",
              description: "以 JSON 返回目标数量和预览路径。",
            },
          ],
        },
        {
          title: "执行清理",
          command: "xiranite cleanf run",
          description: "执行选中的清理预设。",
          examples: [
            {
              label: "执行指定预设",
              command: "xiranite cleanf run --paths \"D:/downloads/a\" --presets empty_folders,backup_files,temp_folders --preview false",
              description: "删除所选预设命中的目标。",
            },
          ],
        },
      ],
      fields: [
        {
          name: "paths",
          type: "string[]",
          required: true,
          description: "要扫描的文件夹路径。",
        },
        {
          name: "presets",
          type: "CleanfPresetId[]",
          description: "清理预设，例如 empty_folders、backup_files、temp_folders、trash_files、hb_txt_files、log_files 或 upscale。",
          defaultValue: "启用的默认项",
        },
        {
          name: "exclude",
          type: "string",
          description: "逗号分隔的排除关键词；命中的路径会被跳过。",
        },
        {
          name: "preview",
          type: "boolean",
          description: "为 true 时只扫描并报告目标，不删除。",
          defaultValue: "true",
        },
      ],
      safety: {
        defaultMode: "preview",
        destructive: [
          "preview=false 的 run 会从磁盘删除文件和文件夹。",
          "complete 和 upscale 预设组合包含更宽的清理规则。",
        ],
        notes: [
          "新目录树第一次使用时务必先预览。",
          "对归档根目录、源文件夹或项目目录使用排除关键词保护。",
        ],
      },
    },
  },
} satisfies NodeHelp
