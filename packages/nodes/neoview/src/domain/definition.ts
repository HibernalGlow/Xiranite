import type { NodeDef } from "@xiranite/contract"

export const def = {
  id: "neoview",
  name: "NeoView",
  version: "0.1.0",
  category: "image",
  description: "High-performance image and comic reader with shared GUI, CLI, and TUI core.",
  icon: "BookImage",
  keywords: ["reader", "comic", "cbz", "archive", "image"],
  externalLaunch: {
    instancePolicy: "reuse",
    requiredHostCapabilities: ["contract", "state", "runner", "clipboard", "downloads", "localFiles", "config", "env"],
    intents: [{
      id: "open",
      targetKinds: ["file", "directory"],
      maxTargets: 1,
    }],
  },
} satisfies NodeDef
