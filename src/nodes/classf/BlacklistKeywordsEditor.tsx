import { DEFAULT_CLASSF_BLACKLIST_KEYWORDS, splitSameaArtistAndCircleKeywords, stripOuterKeywordBrackets } from "@xiranite/node-classf/core"
import { Brackets, ShieldAlert, Split } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ClassfCardState } from "./types"

export function BlacklistKeywordsEditor(props: { data: ClassfCardState; disabled?: boolean; t: Translate; onPatch: (patch: Partial<ClassfCardState>) => void }) {
  const keywords = props.data.blacklistKeywords ?? DEFAULT_CLASSF_BLACKLIST_KEYWORDS
  const title = props.t("fields.blacklistKeywords", "黑名单作者")
  const replaceKeywords = (next: string[]) => props.onPatch({ blacklistKeywords: next })
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label={title} className="w-full justify-between" disabled={props.disabled} size="sm" variant="outline">
          <span className="flex min-w-0 items-center gap-1.5"><ShieldAlert className="size-4 text-destructive" /><span className="truncate text-xs">{title}</span></span>
          <Badge variant="outline">{keywords.length}</Badge>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[min(82vh,620px)] w-[min(94vw,620px)] flex-col gap-3 p-4 sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-destructive" />{title}<Badge variant="outline">{keywords.length}</Badge></DialogTitle>
          <DialogDescription className="sr-only">{props.t("blacklist.editorDescription", "编辑用于将 SameA 作者路由到 del 的黑名单关键词。")}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-1.5">
          <div className="flex items-center justify-end gap-1">
            <EditorIconButton disabled={props.disabled || !keywords.length} icon={Brackets} label={props.t("blacklist.stripOuterBrackets", "去除最外层括号")} onClick={() => replaceKeywords(keywords.map(stripOuterKeywordBrackets).filter(Boolean))} />
            <EditorIconButton disabled={props.disabled || !keywords.length} icon={Split} label={props.t("blacklist.splitArtistCircle", "拆分社团与作者")} onClick={() => replaceKeywords(splitSameaArtistAndCircleKeywords(keywords))} />
          </div>
          <Textarea aria-label="classf blacklist keywords" className="h-[min(48vh,360px)] min-h-28 resize-y font-mono text-xs" disabled={props.disabled} placeholder={props.t("placeholders.blacklistKeywords", "每行一个 SameA 作者标签，例如 [画师] 或 [社团 (画师)]")} value={keywords.join("\n")} onChange={(event) => replaceKeywords(splitLines(event.currentTarget.value))} />
        </div>
        <DialogFooter>
          <DialogClose asChild><Button size="sm">{props.t("common.done", "完成")}</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Translate = (key: string, fallback: string, vars?: Record<string, unknown>) => string

function EditorIconButton(props: { disabled?: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  const Icon = props.icon
  return <Tooltip><TooltipTrigger asChild><Button aria-label={props.label} disabled={props.disabled} size="icon-sm" variant="outline" onClick={props.onClick}><Icon /></Button></TooltipTrigger><TooltipContent>{props.label}</TooltipContent></Tooltip>
}

function splitLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}
