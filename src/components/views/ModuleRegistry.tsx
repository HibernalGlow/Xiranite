import { useState } from "react"
import { useTranslation } from "react-i18next"
import { MODULE_REGISTRY } from "@/components/modules/registry"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { LucideIcon } from "lucide-react"
import {
  FileText, Plus, FlaskConical, Terminal, CheckSquare,
  Clock, Calculator, LayoutDashboard, SlidersHorizontal, Filter,
  Brush, Trash2, Link, MousePointerClick, Package, PackageCheck,
  ArrowRight, FolderInput, FolderTree, FolderSync,
} from "lucide-react"

const ICON_MAP: Record<string, LucideIcon> = {
  FileText, Plus, FlaskConical, Terminal,
  CheckSquare, Clock, Calculator, LayoutDashboard, Filter,
  Brush, Trash2, Link, MousePointerClick, Package, PackageCheck,
  FolderInput, FolderTree, FolderSync,
}

export function ModuleRegistry() {
  const dispatch = useWSDispatch()
  const { state } = useWorkspace()
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState("")
  const [catFilter, setCatFilter] = useState<string | null>(null)

  const categories = Array.from(new Set(MODULE_REGISTRY.map(m => m.category)))

  const filtered = MODULE_REGISTRY.filter(m => {
    const qMatch = !query || m.name.toLowerCase().includes(query.toLowerCase()) || m.description.toLowerCase().includes(query.toLowerCase())
    const cMatch = !catFilter || m.category === catFilter
    return qMatch && cMatch
  })

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border/60 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-3xl font-mono font-black text-foreground tracking-tight">{t("registry:title")}</h1>
          <p className="text-xs font-mono text-muted-foreground mt-1">{t("registry:subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t("registry:searchPlaceholder")}
            className="h-8 w-48 text-xs font-mono bg-muted/40 border-border/60"
          />
          <Button variant="outline" size="sm" className="h-8 font-mono text-xs gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("registry:filter")}
          </Button>
        </div>
      </div>

      {/* Category tabs */}
      <div className="px-6 py-2 flex items-center gap-2 border-b border-border/40 flex-shrink-0">
        <button
          onClick={() => setCatFilter(null)}
          className={cn("text-[10px] font-mono px-2 py-1 rounded-sm border transition-colors", !catFilter ? "border-primary/40 text-primary bg-primary/10" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t("registry:all")}
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setCatFilter(catFilter === cat ? null : cat)}
            className={cn("text-[10px] font-mono px-2 py-1 rounded-sm border transition-colors", catFilter === cat ? "border-primary/40 text-primary bg-primary/10" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t(`registry:categories.${cat}`)}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(mod => {
            const Icon = ICON_MAP[mod.icon] ?? FileText
            const descKey = `module:${mod.id}.description`
            const catKey = `registry:categories.${mod.category}`
            const desc = i18n.exists(descKey) ? t(descKey) : mod.description
            const catLabel = i18n.exists(catKey) ? t(catKey) : mod.category
            return (
              <div
                key={mod.id}
                className="group relative bg-card border border-border/60 rounded-sm p-4 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer"
                onClick={() => {
                  dispatch(actions.deployComponent(mod.id, state.viewMode))
                  dispatch(actions.setOverlay(null))
                }}
              >
                {/* Corner indicator */}
                <div className="absolute top-2 right-2 w-1.5 h-1.5 bg-border rounded-full group-hover:bg-primary transition-colors" />

                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-sm bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-mono text-sm font-bold text-foreground">{mod.name}</span>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed mb-4 line-clamp-3">
                  {desc}
                </p>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground/70">{mod.version}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/50">/</span>
                    <Badge variant="outline" className="text-[9px] font-mono h-4 px-1 border-border/50 text-muted-foreground">
                      {catLabel}
                    </Badge>
                  </div>
                  <button className="flex items-center gap-1 text-[10px] font-mono text-primary opacity-60 group-hover:opacity-100 transition-opacity">
                    {t("registry:deploy")} <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
