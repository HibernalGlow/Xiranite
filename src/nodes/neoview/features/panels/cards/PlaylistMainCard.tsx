import { ChevronDown, ChevronUp, ListMusic, Play, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ReaderPlaylistDto, ReaderPlaylistEntryDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

/**
 * @ast-prototype migration/neoview/playlist-prototype/tsx-scaffold/src/lib/components/panels/PlaylistPanel.tsx
 * @intentional-deviation Legacy localStorage and Tauri picker use the shared Reader library API and explicit paths.
 */
export default function PlaylistMainCard({ client, disabled, panelActive = true, onOpen }: ReaderPanelContext) {
  const [playlists, setPlaylists] = useState<readonly ReaderPlaylistDto[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [entries, setEntries] = useState<readonly ReaderPlaylistEntryDto[]>([])
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const active = useMemo(() => playlists.find((item) => item.id === activeId), [activeId, playlists])

  useEffect(() => {
    if (!panelActive || !client.listPlaylists) return
    const controller = new AbortController()
    void client.listPlaylists(controller.signal).then((items) => {
      if (controller.signal.aborted) return
      setPlaylists(items)
      setActiveId((current) => items.some((item) => item.id === current) ? current : items[0]?.id)
    }).catch((reason) => { if (!controller.signal.aborted) setError(message(reason)) })
    return () => controller.abort()
  }, [client, panelActive])
  useEffect(() => {
    if (!panelActive || !activeId || !client.listPlaylistEntries) { setEntries([]); return }
    const controller = new AbortController()
    void client.listPlaylistEntries(activeId, controller.signal).then((items) => {
      if (!controller.signal.aborted) setEntries(items)
    }).catch((reason) => { if (!controller.signal.aborted) setError(message(reason)) })
    return () => controller.abort()
  }, [activeId, client, panelActive])
  if (!panelActive) return <ReaderCardEmptyState>打开播放列表面板后管理书籍队列</ReaderCardEmptyState>
  if (!client.listPlaylists || !client.savePlaylist || !client.removePlaylist || !client.listPlaylistEntries || !client.appendPlaylistEntries || !client.removePlaylistEntries || !client.reorderPlaylistEntries) return <ReaderCardEmptyState>当前后端未提供播放列表服务</ReaderCardEmptyState>
  async function create() {
    const value = name.trim(); if (!value || pending) return
    setPending(true); setError(undefined)
    try { const item = await client.savePlaylist!({ name: value }); setPlaylists((current) => [...current, item]); setActiveId(item.id); setName("") }
    catch (reason) { setError(message(reason)) } finally { setPending(false) }
  }
  async function add() {
    const value = path.trim(); if (!value || !activeId || pending) return
    setPending(true); setError(undefined)
    try { const added = await client.appendPlaylistEntries!(activeId, [{ name: fileName(value), source: { kind: isArchive(value) ? "archive" : "path", path: value } }]); setEntries((current) => [...current, ...added]); setPath("") }
    catch (reason) { setError(message(reason)) } finally { setPending(false) }
  }
  async function remove(entry: ReaderPlaylistEntryDto) {
    if (!activeId || pending) return
    setPending(true)
    try { await client.removePlaylistEntries!(activeId, [entry.id]); setEntries((current) => current.filter((item) => item.id !== entry.id)) }
    catch (reason) { setError(message(reason)) } finally { setPending(false) }
  }
  async function reorder(index: number, offset: number) {
    if (!activeId || pending || index + offset < 0 || index + offset >= entries.length) return
    const before = entries, next = [...entries]
    ;[next[index]!, next[index + offset]!] = [next[index + offset]!, next[index]!]
    setEntries(next); setPending(true)
    try { await client.reorderPlaylistEntries!(activeId, next.map((item) => item.id)) }
    catch (reason) { setEntries(before); setError(message(reason)) } finally { setPending(false) }
  }
  async function deleteActive() {
    if (!activeId || pending) return
    setPending(true)
    try { await client.removePlaylist!(activeId); const next = playlists.filter((item) => item.id !== activeId); setPlaylists(next); setActiveId(next[0]?.id); setEntries([]) }
    catch (reason) { setError(message(reason)) } finally { setPending(false) }
  }
  return <div className="flex min-h-0 flex-1 flex-col" data-neoview-card="playlist-main">
    <header className="border-b p-2"><div className="flex items-center gap-2"><ListMusic className="size-4"/><span className="text-sm font-semibold">播放列表</span><div className="ml-auto flex gap-1"><Input aria-label="新播放列表名称" className="h-7 w-32 text-xs" value={name} onChange={(event) => setName(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void create() }} placeholder="新列表" disabled={disabled || pending}/><Button size="icon-sm" aria-label="新建播放列表" disabled={disabled || pending || !name.trim()} onClick={() => void create()}><Plus/></Button></div></div><div className="mt-2 flex gap-1 overflow-x-auto">{playlists.map((item) => <Button key={item.id} size="sm" variant={item.id === activeId ? "default" : "secondary"} className="h-7 shrink-0 text-xs" onClick={() => setActiveId(item.id)}>{item.name}</Button>)}</div></header>
    {active ? <><div className="flex gap-1 border-b p-2"><Input aria-label="添加播放列表路径" className="h-7 text-xs" value={path} onChange={(event) => setPath(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void add() }} placeholder="归档、文件或目录路径" disabled={disabled || pending}/><Button size="sm" className="h-7" disabled={disabled || pending || !path.trim()} onClick={() => void add()}><Plus/>添加</Button><Button size="icon-sm" variant="ghost" aria-label="删除播放列表" disabled={disabled || pending} onClick={() => void deleteActive()}><Trash2 className="text-destructive"/></Button></div><div className="min-h-0 flex-1 overflow-auto p-2">{entries.length ? entries.map((item, index) => <div key={item.id} className="group flex items-center gap-1 border-b py-1.5 text-xs"><span className="min-w-0 flex-1 truncate" title={item.source.path}>{item.name}</span><Button size="icon-sm" variant="ghost" aria-label={`打开 ${item.name}`} disabled={disabled || pending} onClick={() => void onOpen?.(item.source.path)}><Play/></Button><Button size="icon-sm" variant="ghost" aria-label={`上移 ${item.name}`} disabled={disabled || pending || index === 0} onClick={() => void reorder(index, -1)}><ChevronUp/></Button><Button size="icon-sm" variant="ghost" aria-label={`下移 ${item.name}`} disabled={disabled || pending || index === entries.length - 1} onClick={() => void reorder(index, 1)}><ChevronDown/></Button><Button size="icon-sm" variant="ghost" aria-label={`移除 ${item.name}`} disabled={disabled || pending} onClick={() => void remove(item)}><Trash2 className="text-destructive"/></Button></div>) : <div className="py-10 text-center text-xs text-muted-foreground"><ListMusic className="mx-auto mb-2 size-8 opacity-40"/>播放列表为空</div>}</div></> : <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">创建播放列表以开始管理书籍队列</div>}
    {error ? <p role="alert" className="border-t p-2 text-xs text-destructive">{error}</p> : null}
  </div>
}
function fileName(path: string) { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }
function isArchive(path: string) { return /\.(zip|cbz|rar|cbr|7z|cb7|cbt|epub)$/i.test(path) }
function message(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
