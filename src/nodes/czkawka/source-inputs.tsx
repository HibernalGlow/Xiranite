import { useState } from "react"
import type { NodeLocalFilesCapability } from "@xiranite/contract"
import { addCzkawkaPaths, isValidCzkawkaExcludedItem, isValidCzkawkaExtensionToken, parseCzkawkaExtensionTokens, parseCzkawkaList, reconcileCzkawkaReferences, removeCzkawkaPaths, serializeCzkawkaExtensionTokens, serializeCzkawkaPaths, setAllCzkawkaReferences, toggleCzkawkaReference } from "@xiranite/node-czkawka/source-inputs"
import { CheckCheck, FolderMinus, FolderPlus, Plus, RotateCcw, Star, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { PathTextarea } from "@/components/ui/path-input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface DirectoryEditorProps {
  kind: "included" | "excluded"
  label: string
  pickDirectory?: NodeLocalFilesCapability["pickDirectory"]
  referenceValue?: string
  value?: string
  onChange: (value: string) => void
  onReferenceChange?: (value: string) => void
}

export function CzkawkaDirectoryEditor({ kind, label, pickDirectory, referenceValue = "", value = "", onChange, onReferenceChange }: DirectoryEditorProps) {
  const [manual, setManual] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const paths = parseCzkawkaList(value)
  const references = reconcileCzkawkaReferences(paths, referenceValue)
  const selectedSet = new Set(selected.filter((path) => paths.includes(path)))
  const allReferences = paths.length > 0 && references.length === paths.length

  function commit(next: string[]) {
    onChange(serializeCzkawkaPaths(next))
    if (onReferenceChange) onReferenceChange(serializeCzkawkaPaths(reconcileCzkawkaReferences(next, references)))
  }

  function add(raw: unknown) {
    const next = addCzkawkaPaths(paths, raw)
    commit(next)
    setManual("")
  }

  async function browse() {
    const path = await pickDirectory?.()
    if (path) add(path)
  }

  function remove(removed: Iterable<string>) {
    const rejected = [...removed]
    commit(removeCzkawkaPaths(paths, rejected))
    setSelected((current) => current.filter((path) => !rejected.includes(path)))
  }

  return <section aria-label={label} data-kind={kind} className="grid gap-2 rounded-md border bg-background/40 p-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-medium"><span>{label}</span><Badge variant="outline">{paths.length}</Badge></div><div className="flex items-center gap-1">
      {onReferenceChange ? <Button aria-label={allReferences ? "取消全部参考目录" : "全部设为参考目录"} size="icon-sm" variant={allReferences ? "secondary" : "ghost"} onClick={() => onReferenceChange(serializeCzkawkaPaths(setAllCzkawkaReferences(paths, !allReferences)))}><CheckCheck /></Button> : null}
      <Button aria-label={`浏览添加${label}`} disabled={!pickDirectory} size="icon-sm" variant="outline" onClick={() => void browse()}><FolderPlus /></Button>
      <Button aria-label={`移除选中的${label}`} disabled={!selectedSet.size} size="icon-sm" variant="outline" onClick={() => remove(selectedSet)}><Trash2 /></Button>
      <Button aria-label={`清空${label}`} disabled={!paths.length} size="icon-sm" variant="ghost" onClick={() => remove(paths)}><FolderMinus /></Button>
    </div></div>
    <div className="grid max-h-40 gap-1 overflow-auto">{paths.length ? paths.map((path) => <div key={path} className="flex items-center gap-2 rounded border px-2 py-1 text-xs">
      <Checkbox aria-label={`选择目录 ${path}`} checked={selectedSet.has(path)} onCheckedChange={(checked) => setSelected((current) => checked ? [...new Set([...current, path])] : current.filter((item) => item !== path))} />
      <span className="min-w-0 flex-1 truncate font-mono" title={path}>{path}</span>
      {onReferenceChange ? <Button aria-label={`${references.includes(path) ? "取消参考" : "设为参考"} ${path}`} size="icon-sm" variant="ghost" onClick={() => onReferenceChange(serializeCzkawkaPaths(toggleCzkawkaReference(paths, references, path)))}><Star className={cn(references.includes(path) && "fill-amber-400 text-amber-500")} /></Button> : null}
      <Button aria-label={`移除目录 ${path}`} size="icon-sm" variant="ghost" onClick={() => remove([path])}><X /></Button>
    </div>) : <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">尚未添加目录</div>}</div>
    <div className="flex items-end gap-1"><PathTextarea aria-label={`批量粘贴${label}`} autoResize={{ minHeight: 36, maxHeight: 96 }} className="font-mono text-xs" placeholder={'可粘贴多行、逗号或分号分隔路径\n也可拖放目录'} value={manual} onValueChange={setManual} /><Button aria-label={`添加粘贴的${label}`} disabled={!parseCzkawkaList(manual).length} size="icon-sm" onClick={() => add(manual)}><Plus /></Button></div>
  </section>
}

interface TokenEditorProps {
  kind: "extensions" | "rules"
  label: string
  placeholder?: string
  value?: string
  onChange: (value: string) => void
}

export function CzkawkaTokenEditor({ kind, label, placeholder, value = "", onChange }: TokenEditorProps) {
  const tokens = kind === "extensions" ? parseCzkawkaExtensionTokens(value) : parseCzkawkaList(value)
  function remove(token: string) {
    const next = tokens.filter((item) => item !== token)
    onChange(kind === "extensions" ? serializeCzkawkaExtensionTokens(next) : serializeCzkawkaPaths(next))
  }
  return <section aria-label={label} className="grid gap-1.5">
    <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{label}</span><Button aria-label={`重置${label}`} disabled={!tokens.length} size="icon-sm" variant="ghost" onClick={() => onChange("")}><RotateCcw /></Button></div>
    <Textarea aria-label={`${label}输入`} className="min-h-16 resize-y font-mono text-xs" placeholder={placeholder} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    {tokens.length ? <div className="flex flex-wrap gap-1">{tokens.map((token) => { const invalid = kind === "extensions" ? !isValidCzkawkaExtensionToken(token) : !isValidCzkawkaExcludedItem(token); return <Badge key={token} variant={invalid ? "destructive" : "secondary"} className="gap-1 font-mono" title={invalid ? kind === "rules" ? "Czkawka 排除规则必须包含 *，或使用 DEFAULT" : "扩展名不能包含点号或空格" : undefined}><span>{token}</span><button type="button" aria-label={`移除 ${token}`} onClick={() => remove(token)}><X className="size-3" /></button></Badge> })}</div> : null}
  </section>
}
