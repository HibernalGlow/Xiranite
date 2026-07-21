import { useState, type ReactNode } from "react"
import { Download, GalleryThumbnails, Play, ShieldAlert } from "lucide-react"
import type { NodeComponentProps, NodeRunEvent } from "@xiranite/contract"
import type { ArcThumbData, ArcThumbInput } from "@xiranite/node-arcthumb/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { ArcThumbCardState } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const state = host.getData<ArcThumbCardState>() ?? {}
  const [busy, setBusy] = useState(false)
  const patch = (next: Partial<ArcThumbCardState>) => host.patchData(compId, next)
  const run = async (write = state.write === true) => {
    const paths = String(state.pathsText ?? "").split(/[\r\n;]+/).map((value) => value.trim()).filter(Boolean)
    if (!paths.length) { patch({ status: "Enter at least one archive or ebook path." }); return }
    setBusy(true); patch({ status: "Preparing ArcThumb.", progress: 0 })
    const input: ArcThumbInput = { action: write ? "render" : "inspect", paths, maxDimension: state.maxDimension ?? 512, format: state.format ?? "webp", quality: state.quality ?? 85, outputDir: state.outputDir, write, overwrite: state.overwrite === true, recursive: state.recursive !== false }
    const result = await host.runner?.run<ArcThumbInput, ArcThumbData>("arcthumb", input, (event: NodeRunEvent) => { if (event.type === "progress") patch({ progress: event.progress, status: event.message }) })
    patch({ result: result?.data ?? null, status: result?.message ?? "ArcThumb runtime is unavailable.", progress: result?.success ? 100 : state.progress })
    setBusy(false)
  }
  return <div className="@container/arcthumb flex h-full min-h-0 w-full flex-col gap-3 overflow-auto p-3" data-testid="arcthumb-workbench">
    <header className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><GalleryThumbnails className="size-4 shrink-0"/><div><h2 className="text-sm font-semibold">ArcThumb</h2><p className="text-xs text-muted-foreground">Native archive and ebook cover thumbnails</p></div></div><span className="text-xs text-muted-foreground">{state.status ?? "Ready"}</span></header>
    <div className="grid gap-3 @3xl/arcthumb:grid-cols-[minmax(0,1fr)_280px]"><section className="space-y-2"><Label htmlFor="arcthumb-paths">Archives and ebooks</Label><Textarea id="arcthumb-paths" aria-label="ArcThumb paths" className="min-h-28 font-mono text-xs" value={state.pathsText ?? ""} placeholder={"D:/library/book.cbz\nD:/library/novel.epub"} onChange={(event) => patch({ pathsText: event.currentTarget.value })}/><div className="grid grid-cols-2 gap-2"><Field label="Maximum dimension"><Input type="number" min={16} max={4096} value={state.maxDimension ?? 512} onChange={(event) => patch({ maxDimension: Number(event.currentTarget.value) })}/></Field><Field label="Quality"><Input type="number" min={1} max={100} value={state.quality ?? 85} onChange={(event) => patch({ quality: Number(event.currentTarget.value) })}/></Field><Field label="Output directory"><Input value={state.outputDir ?? ""} placeholder="Alongside source" onChange={(event) => patch({ outputDir: event.currentTarget.value })}/></Field><Field label="Format"><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={state.format ?? "webp"} onChange={(event) => patch({ format: event.currentTarget.value as ArcThumbCardState["format"] })}><option value="webp">WebP</option><option value="png">PNG</option><option value="jpeg">JPEG</option></select></Field></div><div className="flex flex-wrap gap-4 pt-1"><Toggle label="Write files" checked={state.write === true} onCheckedChange={(write) => patch({ write })}/><Toggle label="Overwrite" checked={state.overwrite === true} onCheckedChange={(overwrite) => patch({ overwrite })}/><Toggle label="Recursive" checked={state.recursive !== false} onCheckedChange={(recursive) => patch({ recursive })}/></div><div className="flex gap-2"><Button disabled={busy} onClick={() => run(false)}><Play/>Inspect</Button><Button disabled={busy || state.write !== true} variant="destructive" onClick={() => run(true)}><Download/>Write thumbnails</Button></div></section><Results data={state.result}/></div>
  </div>
}
function Field(props: { label: string; children: ReactNode }) { return <div className="space-y-1"><Label className="text-xs">{props.label}</Label>{props.children}</div> }
function Toggle(props: { label: string; checked: boolean; onCheckedChange: (value: boolean) => void }) { return <label className="flex items-center gap-2 text-xs"><Switch checked={props.checked} onCheckedChange={props.onCheckedChange}/>{props.label}</label> }
function Results({ data }: { data?: ArcThumbData | null }) { return <aside className="min-h-48 space-y-2 rounded-md border p-2"><div className="flex items-center gap-1 text-xs font-medium"><ShieldAlert className="size-3"/>Results</div>{!data ? <p className="text-xs text-muted-foreground">Inspect an archive to preview its selected cover.</p> : <><p className="text-xs text-muted-foreground">{data.info.archiveFormats.join(", ")}</p>{data.items.map((item) => <div key={item.path} className="border-t pt-2 text-xs"><div className="truncate font-medium">{item.path}</div>{item.previewDataUrl ? <img src={item.previewDataUrl} alt="Selected archive cover" className="mt-1 max-h-32 max-w-full object-contain"/> : null}<div className="text-muted-foreground">{item.status} {item.width ? `${item.width}x${item.height}` : item.reason}</div></div>)}</>}</aside> }
