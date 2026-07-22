import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "Melodeck",
  short: "Play and control local music through mpv from the CLI or TUI.",
  description: "Uses the shared [nodes.melodeck] configuration for GUI, CLI, and TUI playback.",
  whenToUse: [
    "Use Melodeck to launch a local queue or control an existing mpv JSON IPC session.",
  ],
  workflows: [
    {
      title: "Interactive player",
      summary: "Open the OpenTUI music deck.",
      cli: ["Run `xmelodeck ui` in an interactive terminal."],
    },
  ],
  commands: [
    {
      title: "Playback",
      command: "xmelodeck play <audio...>",
      description: "Start mpv with one or more local audio paths.",
      examples: [
        { label: "Open TUI", command: "xmelodeck ui", description: "Open the terminal music deck." },
        { label: "Play files", command: "xmelodeck play D:/Music/track.flac", description: "Launch a local queue." },
        { label: "Control", command: "xmelodeck pause", description: "Pause the active mpv IPC session." },
        { label: "Seek", command: "xmelodeck seek --seek 10", description: "Seek the active track by a relative number of seconds." },
      ],
    },
  ],
} satisfies NodeHelp
