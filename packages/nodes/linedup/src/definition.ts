import type { NodeDef } from "@xiranite/contract"

export const def = {
  id: "linedup",
  name: "Linedup",
  version: "0.1.0",
  category: "text",
  description: "Filter source lines by removing any line containing a filter token.",
  icon: "Filter",
  keywords: ["line", "filter", "dedupe", "text"],
} satisfies NodeDef
