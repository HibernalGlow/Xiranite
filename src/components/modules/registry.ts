import type { ModuleDef } from "@/types/workspace"
import bandiaEntry from "@xiranite/node-bandia"
import cleanfEntry from "@xiranite/node-cleanf"
import crashuEntry from "@xiranite/node-crashu"
import dissolvefEntry from "@xiranite/node-dissolvef"
import encodebEntry from "@xiranite/node-encodeb"
import enginevEntry from "@xiranite/node-enginev"
import findzEntry from "@xiranite/node-findz"
import formatvEntry from "@xiranite/node-formatv"
import kavvkaEntry from "@xiranite/node-kavvka"
import lataEntry from "@xiranite/node-lata"
import linedupEntry from "@xiranite/node-linedup"
import linkuEntry from "@xiranite/node-linku"
import markuEntry from "@xiranite/node-marku"
import migratefEntry from "@xiranite/node-migratef"
import moveaEntry from "@xiranite/node-movea"
import mvzEntry from "@xiranite/node-mvz"
import owithuEntry from "@xiranite/node-owithu"
import rawfilterEntry from "@xiranite/node-rawfilter"
import repackuEntry from "@xiranite/node-repacku"
import recycleuEntry from "@xiranite/node-recycleu"
import reinstallpEntry from "@xiranite/node-reinstallp"
import scoolpEntry from "@xiranite/node-scoolp"
import seriexEntry from "@xiranite/node-seriex"
import sleeptEntry from "@xiranite/node-sleept"
import trenameEntry from "@xiranite/node-trename"
import weibospiderEntry from "@xiranite/node-weibospider"

const PACKAGE_MODULES: ModuleDef[] = [
  bandiaEntry.def,
  cleanfEntry.def,
  crashuEntry.def,
  dissolvefEntry.def,
  encodebEntry.def,
  enginevEntry.def,
  findzEntry.def,
  formatvEntry.def,
  kavvkaEntry.def,
  lataEntry.def,
  linedupEntry.def,
  linkuEntry.def,
  markuEntry.def,
  migratefEntry.def,
  moveaEntry.def,
  mvzEntry.def,
  owithuEntry.def,
  rawfilterEntry.def,
  repackuEntry.def,
  recycleuEntry.def,
  reinstallpEntry.def,
  scoolpEntry.def,
  seriexEntry.def,
  sleeptEntry.def,
  trenameEntry.def,
  weibospiderEntry.def,
]

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
    id: "database",
    name: "DATABASE",
    version: "v0.1.0",
    category: "META",
    description: "Notion 式表格视图：收集所有组件的元数据（模块/状态/可见性/标签/时间），支持排序、筛选、行内编辑。",
    icon: "TableProperties",
  },
  {
    id: "blocknote",
    name: "BLOCKNOTE",
    version: "v1.0.0",
    category: "UTILITY",
    description: "基于 shadcn 的 BlockNote 富文本编辑器。块级文档编辑、拖拽重排、斜杠菜单，样式自动跟随项目主题。",
    icon: "FileText",
  },
]

export function getModule(id: string): ModuleDef | undefined {
  return MODULE_REGISTRY.find(m => m.id === id)
}
