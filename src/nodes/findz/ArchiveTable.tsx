import type { FindzArchiveRow, FindzMemberRow } from "@xiranite/findz-native"
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Image, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { formatBytes, formatDensity } from "./format"
import type { FindzArchiveSort } from "./types"

export function FindzArchiveTable({ archives, members, selectedArchiveId, sortBy, sortDesc, total, hasPreviousPage, hasNextPage, onSelectArchive, onSort, onPreviousPage, onNextPage }: {
  archives: FindzArchiveRow[]
  members?: FindzMemberRow[]
  selectedArchiveId?: number
  sortBy: FindzArchiveSort
  sortDesc: boolean
  total: number
  hasPreviousPage: boolean
  hasNextPage: boolean
  onSelectArchive(archiveId: number): void
  onSort(sort: FindzArchiveSort): void
  onPreviousPage(): void
  onNextPage(): void
}) {
  const { t } = useNodeI18n("findz")
  return (
    <div className="flex min-h-0 flex-1 flex-col border bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2">
        <div className="text-xs text-muted-foreground">{t("workspace.table.indexedSummary", "{{visible}} of {{total}} indexed archives", { visible: archives.length, total })}</div>
        <div className="flex items-center gap-1">
          <Button aria-label={t("workspace.table.previousPage", "Previous archive page")} disabled={!hasPreviousPage} onClick={onPreviousPage} size="xs" variant="ghost"><ChevronLeft /></Button>
          <Button aria-label={t("workspace.table.nextPage", "Next archive page")} disabled={!hasNextPage} onClick={onNextPage} size="xs" variant="ghost"><ChevronRight /></Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Table className="text-xs">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-8" aria-label={t("workspace.table.expandArchive", "Expand archive")} />
              <SortableHead label={t("workspace.table.columns.archive", "Archive")} active={sortBy === "relativePath"} descending={sortDesc} onClick={() => onSort("relativePath")} t={t} />
              <SortableHead label={t("workspace.table.columns.size", "Size")} className="text-right" active={sortBy === "archiveSize"} descending={sortDesc} onClick={() => onSort("archiveSize")} t={t} />
              <SortableHead label={t("workspace.table.columns.images", "Images")} className="text-right" active={sortBy === "imageCount"} descending={sortDesc} onClick={() => onSort("imageCount")} t={t} />
              <SortableHead label={t("workspace.table.columns.analyzed", "Analyzed")} className="text-right" active={sortBy === "analysisCoverage"} descending={sortDesc} onClick={() => onSort("analysisCoverage")} t={t} />
              <SortableHead label={t("workspace.table.columns.density", "Density")} className="text-right" active={sortBy === "averageBytesPerMegapixel"} descending={sortDesc} onClick={() => onSort("averageBytesPerMegapixel")} t={t} />
              <SortableHead label={t("workspace.table.columns.anomalies", "Anomalies")} className="text-right" active={sortBy === "anomalyCount"} descending={sortDesc} onClick={() => onSort("anomalyCount")} t={t} />
              <SortableHead label={t("workspace.table.columns.savings", "Savings")} className="text-right" active={sortBy === "estimatedSavings"} descending={sortDesc} onClick={() => onSort("estimatedSavings")} t={t} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {archives.map((archive) => <ArchiveRows
              key={archive.id}
              archive={archive}
              expanded={selectedArchiveId === archive.id}
              members={selectedArchiveId === archive.id ? members : undefined}
              onSelect={onSelectArchive}
              t={t}
            />)}
            {!archives.length && <TableRow><TableCell colSpan={8} className="h-28 text-center text-sm text-muted-foreground">{t("workspace.table.empty", "Open a library, then run a ZIP scan to populate the index.")}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}

function ArchiveRows({ archive, expanded, members, onSelect, t }: { archive: FindzArchiveRow; expanded: boolean; members?: FindzMemberRow[]; onSelect(archiveId: number): void; t: ReturnType<typeof useNodeI18n>["t"] }) {
  return <>
    <TableRow
      aria-selected={expanded}
      className={cn("cursor-pointer data-[state=selected]:bg-accent/60", expanded && "bg-accent/50")}
      data-testid={`findz-archive-${archive.id}`}
      data-state={expanded ? "selected" : undefined}
      tabIndex={0}
      onClick={() => onSelect(archive.id)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(archive.id) }}
    >
      <TableCell className="w-8 px-2">{expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</TableCell>
      <TableCell className="max-w-72">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium" title={archive.relativePath}>{archive.relativePath}</span>
          <ArchiveScanState archive={archive} />
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatBytes(archive.size)}</TableCell>
      <TableCell className="text-right tabular-nums">{archive.imageMemberCount}</TableCell>
      <TableCell className="text-right tabular-nums">{archive.analyzedImageCount}/{archive.imageMemberCount}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatDensity(archive.averageBytesPerMegapixel)}</TableCell>
      <TableCell className="text-right"><AnomalyBadge count={archive.anomalyCount} /></TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatBytes(archive.estimatedSavingsBytes)}</TableCell>
    </TableRow>
    {expanded && <MemberRows members={members} t={t} />}
  </>
}

function ArchiveScanState({ archive }: { archive: FindzArchiveRow }) {
  const { t } = useNodeI18n("findz")
  const labels: Record<string, string> = {
    corrupt_archive: t("workspace.table.scanStates.corrupt", "Corrupt archive"),
    unsupported_archive: t("workspace.table.scanStates.unsupported", "Unsupported archive"),
    rejected_archive: t("workspace.table.scanStates.rejected", "Rejected archive"),
  }
  const label = labels[archive.scanState]
  if (!label) return null
  return <Badge variant="outline" className="shrink-0 text-[10px]" title={archive.errorCode || archive.scanState}>{label}</Badge>
}

function MemberRows({ members, t }: { members?: FindzMemberRow[]; t: ReturnType<typeof useNodeI18n>["t"] }) {
  if (!members) return <TableRow><TableCell colSpan={8} className="py-3 pl-12 text-xs text-muted-foreground">{t("workspace.table.loadingMembers", "Loading archive members...")}</TableCell></TableRow>
  if (!members.length) return <TableRow><TableCell colSpan={8} className="py-3 pl-12 text-xs text-muted-foreground">{t("workspace.table.noMembers", "This archive has no indexed members.")}</TableCell></TableRow>
  return <>
    {members.map((member) => <TableRow key={member.id} className="bg-muted/30 hover:bg-muted/45">
      <TableCell />
      <TableCell className="max-w-72 truncate pl-7 font-mono text-[11px]" title={member.memberPath}>{member.memberPath}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatBytes(member.compressedSize)}</TableCell>
      <TableCell className="text-right">{member.imageCandidate && <Image className="ml-auto size-3.5 text-muted-foreground" />}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{member.width && member.height ? `${member.width}x${member.height}` : member.metadataStatus || t("workspace.table.pending", "Pending")}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatDensity(member.bytesPerMegapixel)}</TableCell>
      <TableCell className="text-right">{member.anomalyKind && <Badge variant="outline" className="max-w-28 truncate text-[10px]">{member.anomalyKind}</Badge>}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatBytes(member.estimatedSavingsBytes)}</TableCell>
    </TableRow>)}
  </>
}

function SortableHead({ label, active, descending, onClick, className, t }: { label: string; active: boolean; descending: boolean; onClick(): void; className?: string; t: ReturnType<typeof useNodeI18n>["t"] }) {
  return <TableHead className={className}>
    <Button variant="ghost" size="xs" className="h-6 px-1 text-[11px] font-medium" onClick={onClick}>{label}{active && <span aria-label={descending ? t("workspace.table.descending", "descending") : t("workspace.table.ascending", "ascending")}>{descending ? <ArrowDown /> : <ArrowUp />}</span>}</Button>
  </TableHead>
}

function AnomalyBadge({ count }: { count: number }) {
  if (!count) return <span className="text-muted-foreground">0</span>
  return <Badge variant="destructive" className="gap-1 text-[10px]"><TriangleAlert className="size-3" />{count}</Badge>
}
