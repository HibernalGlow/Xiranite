import { Plus, Trash2 } from "lucide-react"
import {
  COMFYGURE_ENABLE_LORA_EFFECT,
  COMFYGURE_RULE_FACTS,
  createComfygureLoraRule,
  type ComfygureControlOptions,
  type ComfygureLora,
  type ComfygureRulePolicy,
} from "@xiranite/node-comfygure/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RuleTreeEditor, type RuleTreeField } from "@/nodes/shared/RuleTreeEditor"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"

type ComfygureT = ReturnType<typeof useNodeI18n>["t"]

export function LoraRuleEditor(props: {
  loras: readonly ComfygureLora[]
  rules: readonly ComfygureRulePolicy[]
  controlOptions?: ComfygureControlOptions
  disabled?: boolean
  t: ComfygureT
  onChange(value: { loras: readonly ComfygureLora[]; rules: readonly ComfygureRulePolicy[] }): void
}) {
  const rules = rulesWithLegacyTriggers(props.loras, props.rules)
  const fields = ruleFields(props.loras, props.controlOptions)

  function commit(loras: readonly ComfygureLora[], nextRules: readonly ComfygureRulePolicy[] = rules) {
    const controlled = new Set(nextRules.flatMap((rule) => rule.effects.map((effect) => effect.payload.loraName)))
    props.onChange({
      loras: loras.map((lora) => controlled.has(lora.name) ? { ...lora, activationTerms: "" } : lora),
      rules: nextRules,
    })
  }

  function updateLora(index: number, patch: Partial<ComfygureLora>) {
    const current = props.loras[index]
    if (!current) return
    const loras = props.loras.map((lora, loraIndex) => loraIndex === index ? { ...lora, ...patch } : lora)
    const nextName = patch.name?.trim()
    const nextRules = nextName && nextName !== current.name
      ? rules.map((rule) => ({
          ...rule,
          effects: rule.effects.map((effect) => effect.payload.loraName === current.name
            ? { ...effect, payload: { loraName: nextName } }
            : effect),
        }))
      : rules
    commit(loras, nextRules)
  }

  function removeLora(index: number) {
    const removed = props.loras[index]
    if (!removed) return
    const loras = props.loras.filter((_, loraIndex) => loraIndex !== index)
    const nextRules = rules.flatMap((rule) => {
      const effects = rule.effects.filter((effect) => effect.payload.loraName !== removed.name)
      return effects.length ? [{ ...rule, effects }] : []
    })
    commit(loras, nextRules)
  }

  function addLora() {
    commit([...props.loras, createLoraDefinition(props.loras)])
  }

  function addRule() {
    const lora = props.loras[0] ?? createLoraDefinition(props.loras)
    const loras = props.loras.length ? props.loras : [lora]
    commit(loras, [...rules, createComfygureLoraRule(lora.name)])
  }

  return <div className="min-w-0 space-y-3" data-testid="comfygure-lora-rule-editor">
    <section className="min-w-0 space-y-2" aria-labelledby="comfygure-lora-heading">
      <div className="flex items-center justify-between gap-2"><div><h4 id="comfygure-lora-heading" className="text-xs font-semibold">{props.t("lora.title", "LoRA stack")}</h4><p className="text-[10px] text-muted-foreground">{props.t("lora.description", "Files, strengths, and prompt terms compiled into the fixed graph.")}</p></div><Button size="sm" variant="outline" disabled={props.disabled} onClick={addLora}><Plus />{props.t("lora.add", "Add LoRA")}</Button></div>
      {props.loras.length ? <div className="space-y-2">{props.loras.map((lora, index) => <div key={`${lora.name}-${index}`} className="min-w-0 space-y-2 border bg-muted/15 p-2" data-testid="comfygure-lora-row">
        <div className="flex min-w-0 items-center gap-2"><Input aria-label={props.t("lora.name", "LoRA file")} className="min-w-0 flex-1 font-mono text-xs" value={lora.name} disabled={props.disabled} onChange={(event) => updateLora(index, { name: event.currentTarget.value })} /><label className="inline-flex shrink-0 items-center gap-1.5 text-xs"><Checkbox checked={lora.enabled !== false} disabled={props.disabled} onCheckedChange={(checked) => updateLora(index, { enabled: checked === true })} />{props.t("lora.enabled", "Enabled")}</label><Button size="icon-sm" variant="ghost" title={props.t("lora.remove", "Remove LoRA")} aria-label={props.t("lora.remove", "Remove LoRA")} disabled={props.disabled} onClick={() => removeLora(index)}><Trash2 /></Button></div>
        <div className="grid gap-2 @xl/comfygure:grid-cols-[120px_120px_minmax(0,1fr)]"><SmallField label={props.t("lora.modelStrength", "Model strength")}><Input type="number" step="0.05" value={lora.modelStrength ?? 1} disabled={props.disabled} onChange={(event) => updateLora(index, { modelStrength: finiteNumber(event.currentTarget.value, 1) })} /></SmallField><SmallField label={props.t("lora.clipStrength", "CLIP strength")}><Input type="number" step="0.05" value={lora.clipStrength ?? 1} disabled={props.disabled} onChange={(event) => updateLora(index, { clipStrength: finiteNumber(event.currentTarget.value, 1) })} /></SmallField><SmallField label={props.t("lora.injectionTerms", "Injected prompt terms")}><Input value={lora.injectionTerms ?? ""} disabled={props.disabled} onChange={(event) => updateLora(index, { injectionTerms: event.currentTarget.value })} /></SmallField></div>
      </div>)}</div> : <div className="border border-dashed bg-muted/10 p-3 text-center text-xs text-muted-foreground">{props.t("lora.empty", "No LoRAs configured.")}</div>}
    </section>

    <section className="min-w-0 space-y-2 border-t pt-3" aria-labelledby="comfygure-rule-heading">
      <div className="flex items-center justify-between gap-2"><div><h4 id="comfygure-rule-heading" className="text-xs font-semibold">{props.t("rules.title", "Activation rules")}</h4><p className="text-[10px] text-muted-foreground">{props.t("rules.description", "Conditions resolve before one fixed JSON graph is compiled.")}</p></div><Button size="sm" variant="outline" disabled={props.disabled} onClick={addRule}><Plus />{props.t("rules.add", "Add rule")}</Button></div>
      {rules.length ? <div className="space-y-2">{rules.map((rule, index) => {
        const target = rule.effects[0]?.payload.loraName ?? props.loras[0]?.name ?? ""
        return <div key={rule.id} className="min-w-0 space-y-2 border bg-muted/15 p-2" data-testid="comfygure-lora-rule">
          <div className="flex min-w-0 flex-wrap items-center gap-2"><Input aria-label={props.t("rules.name", "Rule name")} className="min-w-40 flex-1" value={rule.name} disabled={props.disabled} onChange={(event) => commit(props.loras, replaceRule(rules, index, { ...rule, name: event.currentTarget.value }))} /><SmallField label={props.t("rules.priority", "Priority")} compact><Input className="w-20" type="number" value={rule.priority} disabled={props.disabled} onChange={(event) => commit(props.loras, replaceRule(rules, index, { ...rule, priority: Math.trunc(finiteNumber(event.currentTarget.value, 0)) }))} /></SmallField><label className="inline-flex shrink-0 items-center gap-1.5 text-xs"><Checkbox checked={rule.enabled} disabled={props.disabled} onCheckedChange={(checked) => commit(props.loras, replaceRule(rules, index, { ...rule, enabled: checked === true }))} />{props.t("rules.enabled", "Enabled")}</label><Button size="icon-sm" variant="ghost" title={props.t("rules.remove", "Remove rule")} aria-label={props.t("rules.remove", "Remove rule")} disabled={props.disabled} onClick={() => commit(props.loras, rules.filter((_, ruleIndex) => ruleIndex !== index))}><Trash2 /></Button></div>
          <div className="flex min-w-0 items-center gap-2"><Badge variant="outline">{props.t("rules.effect", "Effect")}</Badge><Select value={target} disabled={props.disabled || props.loras.length === 0} onValueChange={(loraName) => commit(props.loras, replaceRule(rules, index, { ...rule, effects: [{ type: COMFYGURE_ENABLE_LORA_EFFECT, payload: { loraName } }] }))}><SelectTrigger className="min-w-0 flex-1"><SelectValue /></SelectTrigger><SelectContent>{props.loras.map((lora) => <SelectItem key={lora.name} value={lora.name}>{props.t("rules.enableLora", "Enable {{name}}", { name: lora.name })}</SelectItem>)}</SelectContent></Select></div>
          <RuleTreeEditor value={rule.when} fields={fields} disabled={props.disabled} t={props.t} onValueChange={(when) => commit(props.loras, replaceRule(rules, index, { ...rule, when }))} />
        </div>
      })}</div> : <div className="border border-dashed bg-muted/10 p-3 text-center text-xs text-muted-foreground">{props.t("rules.empty", "No conditional rules. Enabled LoRAs without a rule are always applied.")}</div>}
    </section>
  </div>
}

function rulesWithLegacyTriggers(loras: readonly ComfygureLora[], rules: readonly ComfygureRulePolicy[]): readonly ComfygureRulePolicy[] {
  const controlled = new Set(rules.flatMap((rule) => rule.effects.map((effect) => effect.payload.loraName)))
  const legacy = loras.flatMap((lora, loraIndex) => {
    const terms = (lora.activationTerms ?? "").split(/[\n,，、|;；]+/).map((term) => term.trim()).filter(Boolean)
    if (!terms.length || controlled.has(lora.name)) return []
    return [{
      id: `legacy-lora-policy-${loraIndex}`,
      name: `Enable ${lora.name}`,
      enabled: true,
      priority: 0,
      when: {
        format: "xiranite-rule-tree/v1" as const,
        version: 1 as const,
        root: {
          id: `legacy-lora-group-${loraIndex}`,
          kind: "group" as const,
          combinator: terms.length > 1 ? "any" as const : "all" as const,
          not: false,
          children: terms.map((term, termIndex) => ({ id: `legacy-lora-condition-${loraIndex}-${termIndex}`, kind: "condition" as const, field: "prompt.activationText", operator: "contains" as const, value: term })),
        },
      },
      effects: [{ type: COMFYGURE_ENABLE_LORA_EFFECT, payload: { loraName: lora.name } }],
    } satisfies ComfygureRulePolicy]
  })
  return [...rules, ...legacy]
}

function ruleFields(loras: readonly ComfygureLora[], controlOptions?: ComfygureControlOptions): RuleTreeField[] {
  return COMFYGURE_RULE_FACTS.map((fact) => {
    if (fact.name === "lora.names") return { name: fact.name, label: fact.label, type: "multiselect", options: loras.map((lora) => ({ name: lora.name, label: lora.name })) }
    if (fact.name === "sampler.name" && controlOptions?.samplerNames.length) return { name: fact.name, label: fact.label, type: "select", options: controlOptions.samplerNames.map((name) => ({ name, label: name })) }
    if (fact.name === "sampler.scheduler" && controlOptions?.schedulers.length) return { name: fact.name, label: fact.label, type: "select", options: controlOptions.schedulers.map((name) => ({ name, label: name })) }
    if (fact.name === "output.format") return { name: fact.name, label: fact.label, type: "select", options: ["png", "jpeg", "webp"].map((name) => ({ name, label: name.toUpperCase() })) }
    return { name: fact.name, label: fact.label, type: fact.type === "number" ? "number" : fact.type === "boolean" ? "boolean" : "text" }
  })
}

function replaceRule(rules: readonly ComfygureRulePolicy[], index: number, rule: ComfygureRulePolicy): readonly ComfygureRulePolicy[] {
  return rules.map((current, ruleIndex) => ruleIndex === index ? rule : current)
}

function createLoraDefinition(loras: readonly ComfygureLora[]): ComfygureLora {
  const names = new Set(loras.map((lora) => lora.name))
  let sequence = loras.length + 1
  let name = `new-lora-${sequence}.safetensors`
  while (names.has(name)) name = `new-lora-${++sequence}.safetensors`
  return { name, modelStrength: 1, clipStrength: 1, injectionTerms: "", enabled: true }
}

function finiteNumber(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function SmallField(props: { label: string; compact?: boolean; children: React.ReactNode }) {
  return <label className={props.compact ? "flex shrink-0 items-center gap-1.5" : "block min-w-0 space-y-1"}><span className="text-[10px] font-medium text-muted-foreground">{props.label}</span>{props.children}</label>
}
