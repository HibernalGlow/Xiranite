import type { FindzArchiveRow, FindzMemberRow } from "@xiranite/findz-native"
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Image, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
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
  return (
    <div className="flex min-h-0 flex-1 flex-col border bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2">
        <div className="text-xs text-muted-foreground">{archives.length} of {total} indexed archives</div>
        <div className="flex items-center gap-1">
          <Button aria-label="Previous archive page" disabled={!hasPreviousPage} onClick={onPreviousPage} size="xs" variant="ghost"><ChevronLeft /></Button>
          <Button aria-label="Next archive page" disabled={!hasNextPage} onClick={onNextPage} size="xs" variant="ghost"><ChevronRight /></Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Table className="text-xs">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-8" aria-label="Expand archive" />
              <SortableHead label="Archive" active={sortBy === "relativePath"} descending={sortDesc} onClick={() => onSort("relativePath")} />
              <SortableHead label="Size" className="text-right" active={sortBy === "archiveSize"} descending={sortDesc} onClick={() => onSort("archiveSize")} />
              <SortableHead label="Images" className="text-right" active={sortBy === "imageCount"} descending={sortDesc} onClick={() => onSort("imageCount")} />
              <SortableHead label="Analyzed" className="text-right" active={sortBy === "analysisCoverage"} descending={sortDesc} onClick={() => onSort("analysisCoverage")} />
              <SortableHead label="Density" className="text-right" active={sortBy === "averageBytesPerMegapixel"} descending={sortDesc} onClick={() => onSort("averageBytesPerMegapixel")} />
              <SortableHead label="Anomalies" className="text-right" active={sortBy === "anomalyCount"} descending={sortDesc} onClick={() => onSort("anomalyCount")} />
              <SortableHead label="Savings" className="text-right" active={sortBy === "estimatedSavings"} descending={sortDesc} onClick={() => onSort("estimatedSavings")} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {archives.map((archive) => <ArchiveRows
              key={archive.id}
              archive={archive}
              expanded={selectedArchiveId === archive.id}
              members={selectedArchiveId === archive.id ? members : undefined}
              onSelect={onSelectArchive}
            />)}
            {!archives.length && <TableRow><TableCell colSpan={8} className="h-28 text-center text-sm text-muted-foreground">Open a library, then run a ZIP scan to populate the index.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}

function ArchiveRows({ archive, expanded, members, onSelect }: { archive: FindzArchiveRow; expanded: boolean; members?: FindzMemberRow[]; onSelect(archiveId: number): void }) {
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
    {expanded && <MemberRows members={members} />}
  </>
}

function ArchiveScanState({ archive }: { archive: FindzArchiveRow }) {
  const labels: Record<string, string> = {
    corrupt_archive: "Corrupt archive",
    unsupported_archive: "Unsupported archive",
    rejected_archive: "Rejected archive",
  }
  const label = labels[archive.scanState]
  if (!label) return null
  return <Badge variant="outline" className="shrink-0 text-[10px]" title={archive.errorCode || archive.scanState}>{label}</Badge>
}

function MemberRows({ members }: { members?: FindzMemberRow[] }) {
  if (!members) return <TableRow><TableCell colSpan={8} className="py-3 pl-12 text-xs text-muted-foreground">Loading archive members...</TableCell></TableRow>
  if (!members.length) return <TableRow><TableCell colSpan={8} className="py-3 pl-12 text-xs text-muted-foreground">This archive has no indexed members.</TableCell></TableRow>
  return <>
    {members.map((member) => <TableRow key={member.id} className="bg-muted/30 hover:bg-muted/45">
      <TableCell />
      <TableCell className="max-w-72 truncate pl-7 font-mono text-[11px]" title={member.memberPath}>{member.memberPath}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatBytes(member.compressedSize)}</TableCell>
      <TableCell className="text-right">{member.imageCandidate && <Image className="ml-auto size-3.5 text-muted-foreground" />}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{member.width && member.height ? `${member.width}x${member.height}` : member.metadataStatus || "Pending"}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatDensity(member.bytesPerMegapixel)}</TableCell>
      <TableCell className="text-right">{member.anomalyKind && <Badge variant="outline" className="max-w-28 truncate text-[10px]">{member.anomalyKind}</Badge>}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatBytes(member.estimatedSavingsBytes)}</TableCell>
    </TableRow>)}
  </>
}

function SortableHead({ label, active, descending, onClick, className }: { label: string; active: boolean; descending: boolean; onClick(): void; className?: string }) {
  return <TableHead className={className}>
    <Button variant="ghost" size="xs" className="h-6 px-1 text-[11px] font-medium" onClick={onClick}>{label}{active && <span aria-label={descending ? "descending" : "ascending"}>{descending ? <ArrowDown /> : <ArrowUp />}</span>}</Button>
  </TableHead>
}

function AnomalyBadge({ count }: { count: number }) {
  if (!count) return <span className="text-muted-foreground">0</span>
  return <Badge variant="destructive" className="gap-1 text-[10px]"><TriangleAlert className="size-3" />{count}</Badge>
}
