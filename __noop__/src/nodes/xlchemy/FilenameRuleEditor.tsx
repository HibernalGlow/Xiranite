import { useEffect, useState } from "react"
import type { XlchemyFilenameRule, XlchemyFormat, XlchemyOutputMode } from "@xiranite/node-xlchemy/core"
import { DEFAULT_FILENAME_RULES } from "@xiranite/node-xlchemy/core"
import { ArrowDown, ArrowUp, Braces, Plus, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FORMATS } from "./constants"

export function FilenameRuleEditor(props: { compact?: boolean; disabled?: boolean; rules?: XlchemyFilenameRule[]; onChange: (rules: XlchemyFilenameRule[]) => void }) {
  const [rules, setRules] = useState<XlchemyFilenameRule[]>(() => props.rules ?? cloneDefaultRules())
  useEffect(() => { setRules(props.rules ?? cloneDefaultRules()) }, [props.rules])
  const commit = (next: XlchemyFilenameRule[]) => { setRules(next); props.onChange(next) }
  const update = (index: number, patch: Partial<XlchemyFilenameRule>) => commit(rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule))
  const move = (index: number, offset: number) => { const target = index + offset; if (target < 0 || target >= rules.length) return; const next = [...rules]; [next[index], next[target]] = [next[target]!, next[index]!]; commit(next) }
  const remove = (index: number) => commit(rules.filter((_, ruleIndex) => ruleIndex !== index))
  const add = () => commit([...rules, { id: `rule-${Date.now().toString(36)}`, enabled: true, inputExtensions: [], outputFormats: [], outputModes: [], matchTarget: "filename", matcher: "glob", pattern: "*", prefix: "", suffix: "" }])

  return (
    <Dialog>
      <DialogTrigger asChild><Button aria-label="打开命名规则编辑器" disabled={props.disabled} size={props.compact ? "icon-sm" : "sm"} variant="outline"><Braces />{!props.compact && <>命名规则 <span className="text-muted-foreground">{rules.length}</span></>}</Button></DialogTrigger>
      <DialogContent className="grid max-h-[86vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-4xl">
        <DialogHeader><DialogTitle>命名规则编辑器</DialogTitle><DialogDescription>规则从上到下匹配；所有命中的前缀和后缀会先组合，再执行同名文件策略。扩展名不需要输入点号。</DialogDescription></DialogHeader>
        <ScrollArea className="min-h-0 pr-3">
          <div className="grid gap-3">
            {rules.map((rule, index) => <RuleCard key={rule.id} index={index} rule={rule} count={rules.length} onUpdate={(patch) => update(index, patch)} onMove={(offset) => move(index, offset)} onRemove={() => remove(index)} />)}
            {!rules.length && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">当前没有命名规则，输出将沿用原文件名。</div>}
          </div>
        </ScrollArea>
        <div className="flex items-center justify-between gap-2 border-t pt-3"><Button variant="ghost" onClick={() => commit(cloneDefaultRules())}><RotateCcw />恢复 PSD / CLIP 默认规则</Button><Button onClick={add}><Plus />添加规则</Button></div>
      </DialogContent>
    </Dialog>
  )
}

function RuleCard(props: { index: number; count: number; rule: XlchemyFilenameRule; onUpdate: (patch: Partial<XlchemyFilenameRule>) => void; onMove: (offset: number) => void; onRemove: () => void }) {
  const rule = props.rule
  return <section aria-label={`命名规则 ${props.index + 1}`} className="grid gap-3 rounded-xl border bg-card/60 p-3 shadow-sm">
    <div className="flex items-center gap-2"><Switch aria-label={`启用命名规则 ${props.index + 1}`} checked={rule.enabled} onCheckedChange={(enabled) => props.onUpdate({ enabled })} /><span className="text-xs font-semibold">规则 {props.index + 1}</span><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary(rule)}</span><Button aria-label="上移规则" disabled={props.index === 0} size="icon-xs" variant="ghost" onClick={() => props.onMove(-1)}><ArrowUp /></Button><Button aria-label="下移规则" disabled={props.index === props.count - 1} size="icon-xs" variant="ghost" onClick={() => props.onMove(1)}><ArrowDown /></Button><Button aria-label="删除命名规则" size="icon-xs" variant="ghost" className="text-destructive" onClick={props.onRemove}><Trash2 /></Button></div>
    <div className="grid gap-2 md:grid-cols-3">
      <TextField label="输入扩展名" placeholder="全部，或 psd, clip" value={rule.inputExtensions.join(", ")} onChange={(value) => props.onUpdate({ inputExtensions: splitList(value) })} />
      <SelectField label="目标格式" value={rule.outputFormats[0] ?? "*"} options={[["*", "全部格式"], ...FORMATS.map((format) => [format.value, format.label])]} onChange={(value) => props.onUpdate({ outputFormats: value === "*" ? [] : [value as XlchemyFormat] })} />
      <SelectField label="输出模式" value={rule.outputModes[0] ?? "*"} options={[["*", "全部模式"], ["source", "源文件旁"], ["directory", "指定目录"]]} onChange={(value) => props.onUpdate({ outputModes: value === "*" ? [] : [value as XlchemyOutputMode] })} />
      <SelectField label="匹配对象" value={rule.matchTarget} options={[["filename", "文件名"], ["path", "完整路径"]]} onChange={(value) => props.onUpdate({ matchTarget: value as XlchemyFilenameRule["matchTarget"] })} />
      <SelectField label="匹配方式" value={rule.matcher} options={[["glob", "Glob"], ["contains", "包含文本"], ["regex", "正则表达式"]]} onChange={(value) => props.onUpdate({ matcher: value as XlchemyFilenameRule["matcher"] })} />
      <TextField label="匹配表达式" placeholder="* 或 */assets/*" value={rule.pattern} onChange={(pattern) => props.onUpdate({ pattern })} />
      <TextField label="添加前缀" placeholder="例如 optimized-" value={rule.prefix} onChange={(prefix) => props.onUpdate({ prefix })} />
      <TextField label="添加后缀" placeholder="例如 [PSD]" value={rule.suffix} onChange={(suffix) => props.onUpdate({ suffix })} />
    </div>
  </section>
}

function TextField(props: { label: string; placeholder: string; value: string; onChange: (value: string) => void }) { return <Field className="gap-1"><FieldLabel className="text-[10px]">{props.label}</FieldLabel><Input aria-label={props.label} className="h-8 text-xs" placeholder={props.placeholder} value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)} /></Field> }
function SelectField(props: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <Field className="gap-1"><FieldLabel className="text-[10px]">{props.label}</FieldLabel><Select value={props.value} onValueChange={props.onChange}><SelectTrigger aria-label={props.label} className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{props.options.map(([value, label]) => <SelectItem key={value} value={value!}>{label}</SelectItem>)}</SelectContent></Select></Field> }
function splitList(value: string) { return value.split(/[,;\s]+/).map((item) => item.trim().replace(/^\./, "").toLowerCase()).filter(Boolean) }
function summary(rule: XlchemyFilenameRule) { const scope = rule.inputExtensions.length ? rule.inputExtensions.map((item) => `.${item}`).join(", ") : "全部输入"; return `${scope} · ${rule.prefix || "∅"}名称${rule.suffix || "∅"}` }
function cloneDefaultRules() { return DEFAULT_FILENAME_RULES.map((rule) => ({ ...rule, inputExtensions: [...rule.inputExtensions], outputFormats: [...rule.outputFormats], outputModes: [...rule.outputModes] })) }
