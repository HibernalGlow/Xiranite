/**
 * DatabaseModule — Notion 式表格视图。
 *
 * 收集当前 workspace 所有组件的元数据，按表格展示：
 * - 模块 / 状态 / 可见性（在哪些 viewMode 显示）/ 标签 / 创建时间 / 修改时间
 * - 支持排序（点列头切换 asc/desc）
 * - 支持筛选（按模块名/标签搜索）
 * - 支持行内编辑标签字段（tags 为 string[]，回车添加）
 *
 * 数据全部从 store 读取，无需后端持久化（comp.data 已经在 workspaceContext 持久化）。
 * 后续可扩展为用户自定义字段（schema-driven）。
 */
import { useMemo, useState } from "react"
import { Search, Tag, X, ArrowUpDown, ArrowUp, ArrowDown, Eye, EyeOff } from "lucide-react"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { useComponentData } from "@/hooks/useComponentData"
import { getModule } from "@/components/modules/registry"
import type { ComponentInstance, ViewMode } from "@/types/workspace"
import type { ModuleProps } from "./ModuleRenderer"
import { cn } from "@/lib/utils"

interface DatabaseState {
  /** 用户自定义标签 — key 为 componentId，value 为 tag 数组 */
  tagsByComponent?: Record<string, string[]>
  /** 当前排序列 */
  sortKey?: SortKey
  sortDir?: "asc" | "desc"
  /** 筛选关键字 */
  filterText?: string
}

type SortKey = "moduleId" | "state" | "visibility" | "tags" | "createdAt" | "modifiedAt"

const VIEW_MODES: ViewMode[] = ["cards", "dockview", "flow", "lane"]

function formatTime(ts: number | undefined): string {
  if (!ts) return "—"
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

export default function DatabaseModule({ compId }: ModuleProps) {
  const { visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()
  const [data, setData] = useComponentData<DatabaseState>(compId)
  const [tagInput, setTagInput] = useState<Record<string, string>>({})

  const tagsByComponent = data.tagsByComponent ?? {}
  const sortKey = data.sortKey ?? "moduleId"
  const sortDir = data.sortDir ?? "asc"
  const filterText = data.filterText ?? ""

  // 排序+筛选后的行
  const rows = useMemo(() => {
    let list = visibleComponents.slice()
    if (filterText.trim()) {
      const q = filterText.toLowerCase()
      list = list.filter(c => {
        const mod = getModule(c.moduleId)
        const name = (mod?.name ?? c.moduleId).toLowerCase()
        const tags = (tagsByComponent[c.id] ?? []).join(" ").toLowerCase()
        return name.includes(q) || tags.includes(q) || c.id.includes(q)
      })
    }
    const dir = sortDir === "asc" ? 1 : -1
    list.sort((a, b) => {
      let va: string | number = ""
      let vb: string | number = ""
      switch (sortKey) {
        case "moduleId":
          va = a.moduleId; vb = b.moduleId; break
        case "state":
          va = a.state; vb = b.state; break
        case "visibility":
          va = VIEW_MODES.filter(m => !a.hiddenIn?.[m]).length
          vb = VIEW_MODES.filter(m => !b.hiddenIn?.[m]).length
          break
        case "tags":
          va = (tagsByComponent[a.id] ?? []).join(",")
          vb = (tagsByComponent[b.id] ?? []).join(",")
          break
        case "createdAt":
          va = parseInt(a.id.split("-").pop() ?? "0", 10)
          vb = parseInt(b.id.split("-").pop() ?? "0", 10)
          break
        case "modifiedAt":
          va = a.data ? Object.keys(a.data).length : 0
          vb = b.data ? Object.keys(b.data).length : 0
          break
      }
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return list
  }, [visibleComponents, filterText, sortKey, sortDir, tagsByComponent])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setData({ sortDir: sortDir === "asc" ? "desc" : "asc" })
    } else {
      setData({ sortKey: key, sortDir: "asc" })
    }
  }

  function addTag(compId: string) {
    const text = (tagInput[compId] ?? "").trim()
    if (!text) return
    const cur = tagsByComponent[compId] ?? []
    if (cur.includes(text)) { setTagInput({ ...tagInput, [compId]: "" }); return }
    const next = { ...tagsByComponent, [compId]: [...cur, text] }
    setData({ tagsByComponent: next })
    setTagInput({ ...tagInput, [compId]: "" })
  }

  function removeTag(compId: string, tag: string) {
    const cur = tagsByComponent[compId] ?? []
    const next = { ...tagsByComponent, [compId]: cur.filter(t => t !== tag) }
    setData({ tagsByComponent: next })
  }

  function toggleVisibility(comp: ComponentInstance, mode: ViewMode) {
    dispatch(actions.toggleComponentVisibility(comp.id, mode))
  }

  function SortHeader({ k, label }: { k: SortKey; label: string }) {
    const active = sortKey === k
    return (
      <button
        onClick={() => toggleSort(k)}
        className={cn(
          "flex items-center gap-1 text-[10px] font-mono tracking-widest uppercase px-2 py-1 hover:bg-muted/60 transition-colors",
          active ? "text-primary" : "text-muted-foreground"
        )}
      >
        {label}
        {active ? (
          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    )
  }

  if (visibleComponents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <p className="text-sm font-mono text-muted-foreground">// no components to display</p>
          <p className="text-[10px] font-mono text-muted-foreground/60">Deploy some modules first.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-card">
      {/* 顶栏：搜索 + 计数 */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border/40 bg-muted/20 flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-1 max-w-xs">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={filterText}
            onChange={(e) => setData({ filterText: e.target.value })}
            placeholder="Filter by name / tag / id..."
            className="flex-1 bg-transparent text-xs font-mono outline-none placeholder:text-muted-foreground/60"
          />
          {filterText && (
            <button onClick={() => setData({ filterText: "" })} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {rows.length} / {visibleComponents.length} ROWS
        </div>
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs font-mono">
          <thead className="sticky top-0 bg-muted/40 backdrop-blur z-10">
            <tr className="border-b border-border/60">
              <th className="text-left"><SortHeader k="moduleId" label="Module" /></th>
              <th className="text-left"><SortHeader k="state" label="State" /></th>
              <th className="text-left"><SortHeader k="visibility" label="Visibility" /></th>
              <th className="text-left"><SortHeader k="tags" label="Tags" /></th>
              <th className="text-left"><SortHeader k="createdAt" label="Created" /></th>
              <th className="text-left"><SortHeader k="modifiedAt" label="Data Size" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(comp => {
              const mod = getModule(comp.moduleId)
              const tags = tagsByComponent[comp.id] ?? []
              const inputVal = tagInput[comp.id] ?? ""
              return (
                <tr key={comp.id} className="border-b border-border/30 hover:bg-muted/30 group">
                  {/* Module */}
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col">
                      <span className="text-foreground font-semibold">{mod?.name ?? comp.moduleId}</span>
                      <span className="text-[9px] text-muted-foreground">{comp.id}</span>
                    </div>
                  </td>
                  {/* State */}
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-muted/60 uppercase tracking-wider">
                      {comp.state}
                    </span>
                  </td>
                  {/* Visibility — 4 个 viewMode 各自的开关 */}
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      {VIEW_MODES.map(m => {
                        const hidden = comp.hiddenIn?.[m]
                        return (
                          <button
                            key={m}
                            onClick={() => toggleVisibility(comp, m)}
                            title={`${m}: ${hidden ? "hidden" : "visible"}`}
                            className={cn(
                              "grid h-5 w-5 place-items-center rounded border",
                              hidden
                                ? "border-border/40 text-muted-foreground/40 hover:text-foreground"
                                : "border-primary/40 bg-primary/10 text-primary"
                            )}
                          >
                            {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </button>
                        )
                      })}
                    </div>
                  </td>
                  {/* Tags — 行内编辑 */}
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {tags.map(t => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px]"
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {t}
                          <button
                            onClick={() => removeTag(comp.id, t)}
                            className="hover:text-destructive ml-0.5"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))}
                      <input
                        value={inputVal}
                        onChange={(e) => setTagInput({ ...tagInput, [comp.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); addTag(comp.id) }
                          if (e.key === "Backspace" && !inputVal && tags.length > 0) {
                            removeTag(comp.id, tags[tags.length - 1])
                          }
                        }}
                        placeholder="+ tag"
                        className="bg-transparent text-[10px] outline-none w-16 placeholder:text-muted-foreground/60 focus:bg-background focus:px-1 focus:rounded focus:border focus:border-border/60"
                      />
                    </div>
                  </td>
                  {/* Created */}
                  <td className="px-2 py-1.5 text-muted-foreground text-[10px]">
                    {formatTime(parseInt(comp.id.split("-").pop() ?? "0", 10))}
                  </td>
                  {/* Data Size */}
                  <td className="px-2 py-1.5 text-muted-foreground text-[10px]">
                    {comp.data ? `${Object.keys(comp.data).length} keys` : "—"}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="p-8 text-center text-[10px] font-mono text-muted-foreground">
            // no rows match filter "{filterText}"
          </div>
        )}
      </div>
    </div>
  )
}
