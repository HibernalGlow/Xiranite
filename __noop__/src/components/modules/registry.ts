import type { ModuleDef } from "@/types/workspace"
import { PACKAGE_MODULES } from "./packageModules.generated"

export const MODULE_REGISTRY: ModuleDef[] = [
  ...PACKAGE_MODULES,
  {
    id: "scratch",
    name: "SCRATCH",
    version: "v1.2.0",
    category: "UTILITY",
    description: "Ephemeral text buffer. Temporary storage for quick notes, variables, or copy-paste ops.",
    icon: "FileText",
  },
  {
    id: "counter",
    name: "COUNTER",
    version: "v0.9.4",
    category: "STATE",
    description: "Incremental tracking node. Stateful integer tracking with broadcast capabilities.",
    icon: "Plus",
  },
  {
    id: "tasks",
    name: "TASKS",
    version: "v1.0.5",
    category: "ORGANIZE",
    description: "Linear objective tracker. Sequential list management for operator workflows.",
    icon: "CheckSquare",
  },
  {
    id: "clock",
    name: "CLOCK",
    version: "v2.2.1",
    category: "UTILITY",
    description: "Global/Local temporal reference. High-precision sync with central server time.",
    icon: "Clock",
  },
  {
    id: "calculator",
    name: "CALCULATOR",
    version: "v1.1.0",
    category: "UTILITY",
    description: "Arithmetic processing unit. Essential localized computation and conversion tool.",
    icon: "Calculator",
  },
  {
    id: "kanban",
    name: "KANBAN BOARD",
    version: "v3.0.2",
    category: "ORGANIZE",
    description: "Editable workspace board powered by the shared Data View engine.",
    icon: "LayoutDashboard",
  },

  {
    id: "database",
    name: "DATABASE",
    version: "v0.1.0",
    category: "META",
    description: "Notion-style table view: collects metadata of all components (module/state/visibility/tags/time), supports sorting, filtering, inline editing.",
    icon: "TableProperties",
  },
  {
    id: "blocknote",
    name: "BLOCKNOTE",
    version: "v1.0.0",
    category: "UTILITY",
    description: "BlockNote rich text editor based on shadcn. Block-level document editing, drag-and-drop reordering, slash menu, styles follow project theme automatically.",
    icon: "FileText",
  },
  {
    id: "music-player",
    name: "MUSIC PLAYER",
    version: "v0.1.0",
    category: "MEDIA",
    description: "Local music player backed by Xiranite runtime file service. Supports FLAC folders, playlists, and themed dock playback.",
    icon: "Music2",
  },
  {
    id: "settings",
    name: "SETTINGS",
    version: "v1.0.0",
    category: "SYSTEM",
    description: "Universal project settings: appearance, background, runtime, and local data configuration.",
    icon: "Settings",
  },
  {
    id: "module-registry",
    name: "MODULE REGISTRY",
    version: "v1.0.0",
    category: "SYSTEM",
    description: "Browse, search, and deploy all available modules into the workspace.",
    icon: "PackageOpen",
  },
  {
    id: "node-history",
    name: "RUN HISTORY",
    version: "v1.0.0",
    category: "META",
    description: "Runtime history of node, workspace, config, and system events with filtering.",
    icon: "History",
  },
  {
    id: "node-operations",
    name: "NODE OPERATIONS",
    version: "v1.0.0",
    category: "META",
    description: "Live backend node runs: active, recent, and finished operations with stream events.",
    icon: "Activity",
  },
]

export function getModule(id: string): ModuleDef | undefined {
  return MODULE_REGISTRY.find(m => m.id === id)
}
