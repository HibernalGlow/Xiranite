import type { ModuleDef } from "@/types/workspace"

export const MODULE_REGISTRY: ModuleDef[] = [
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
    id: "acid-mixer",
    name: "ACID MIXER",
    version: "v2.1.0",
    category: "PROCESS",
    description: "Compound synthesizer logic board. Combine distinct data streams to generate new outputs.",
    icon: "FlaskConical",
  },
  {
    id: "terminal",
    name: "TERMINAL",
    version: "v4.0.0",
    category: "SYSTEM",
    description: "Command line interface node. Direct execution access to core system services.",
    icon: "Terminal",
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
    description: "Agile workflow visualization. Drag-and-drop state management for complex operations.",
    icon: "LayoutDashboard",
  },
  {
    id: "enginev",
    name: "ENGINE-V",
    version: "v1.0.0",
    category: "FILE",
    description: "Wallpaper Engine 工坊管理：扫描 / 过滤 / 批量重命名 / 删除 / 导出。端到端示例服务。",
    icon: "Image",
  },
  {
    id: "database",
    name: "DATABASE",
    version: "v0.1.0",
    category: "META",
    description: "Notion 式表格视图：收集所有组件的元数据（模块/状态/可见性/标签/时间），支持排序、筛选、行内编辑。",
    icon: "TableProperties",
  },
]

export function getModule(id: string): ModuleDef | undefined {
  return MODULE_REGISTRY.find(m => m.id === id)
}
