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
      terminal: [
        "Copy one or more folder paths to the clipboard.",
        "Run `xiranite cleanf` and choose the clipboard path source.",
        "Select a preset combination, preview targets, then confirm live deletion only when the target list is correct.",
      ],
    },
    {
      title: "Scripted CLI",
      summary: "Use explicit commands for repeatable cleanup jobs.",
      terminal: [
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
} satisfies NodeHelp
