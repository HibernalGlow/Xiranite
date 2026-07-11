import { useCallback, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react"
import { ArrowUp, ChevronsUp } from "lucide-react"
import { MODULE_REGISTRY } from "@/components/modules/registry"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useWorkspaceActions, useWorkspaceShallowSelector } from "@/store/workspaceStore"
import type { ModuleDef } from "@/types/workspace"

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")

export function getModulesForInitial(initial: string, modules: readonly ModuleDef[] = MODULE_REGISTRY): ModuleDef[] {
  const normalized = initial.trim().slice(0, 1).toLocaleUpperCase()
  if (!normalized) return []
  return modules.filter((module) => module.name.toLocaleUpperCase().startsWith(normalized))
}

function selectLetter(selection: string[], letter: string): string[] {
  if (selection.includes(letter)) return selection.filter((item) => item !== letter)
  return [...selection, letter].slice(-2)
}

export function AlphabetNodeRail() {
  const workspaceActions = useWorkspaceActions()
  const viewMode = useWorkspaceShallowSelector((state) => state.viewMode)
  const [selection, setSelection] = useState<string[]>([])
  const [announce, setAnnounce] = useState("")
  const railRef = useRef<HTMLDivElement>(null)
  const startYRef = useRef<number | null>(null)
  const primaryInitial = selection[0]
  const matchingModules = useMemo(() => primaryInitial ? getModulesForInitial(primaryInitial) : [], [primaryInitial])
  const primaryModule = matchingModules[0]

  const deploySelectedNode = useCallback(() => {
    if (selection.length !== 2 || !primaryInitial) {
      setAnnounce("Select two letters first.")
      return
    }
    if (!primaryModule) {
      setAnnounce(`No registered node starts with ${primaryInitial}.`)
      return
    }
    workspaceActions.deployComponent(primaryModule.id, viewMode)
    setAnnounce(`${primaryModule.name} was added to the current view.`)
  }, [primaryInitial, primaryModule, selection.length, viewMode, workspaceActions])

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const rail = railRef.current
    if (!rail || event.deltaY === 0) return
    event.preventDefault()
    rail.scrollBy({ left: event.deltaY, behavior: "smooth" })
  }, [])

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    startYRef.current = event.clientY
  }, [])

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const startY = startYRef.current
    startYRef.current = null
    if (startY !== null && startY - event.clientY > 42) deploySelectedNode()
  }, [deploySelectedNode])

  return (
    <section
      className="xiranite-ui-copy pointer-events-auto absolute inset-x-3 bottom-3 z-20 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border border-border/70 bg-card/90 p-1.5 shadow-lg shadow-black/10 backdrop-blur-md"
      aria-label="Alphabetical node launcher"
      data-testid="alphabet-node-rail"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <Button
        type="button"
        size="icon-sm"
        variant="secondary"
        className="shrink-0 border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
        aria-label={selection.length === 2 ? `Add a node beginning with ${primaryInitial}` : "Select two letters to add a node"}
        title={selection.length === 2 ? "Swipe up or click to add the selected node" : "Select two letters, then swipe up"}
        disabled={selection.length !== 2 || !primaryModule}
        onClick={deploySelectedNode}
        data-testid="alphabet-node-rail-deploy"
      >
        <ChevronsUp className="size-4" />
      </Button>
      <div className="min-w-0">
        <div
          ref={railRef}
          className="flex max-w-[min(66vw,680px)] items-center gap-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onWheel={handleWheel}
          aria-label="Alphabet selector"
        >
          {ALPHABET.map((letter) => {
            const selectedIndex = selection.indexOf(letter)
            const count = getModulesForInitial(letter).length
            return (
              <button
                key={letter}
                type="button"
                className={cn(
                  "relative grid size-7 shrink-0 place-items-center rounded-sm border text-[11px] font-mono font-semibold transition-colors",
                  selectedIndex >= 0
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
                )}
                aria-pressed={selectedIndex >= 0}
                aria-label={`${letter}, ${count} matching nodes`}
                title={`${letter}: ${count} matching nodes`}
                onClick={() => setSelection((current) => selectLetter(current, letter))}
                data-testid={`alphabet-node-letter-${letter}`}
              >
                {letter}
                {selectedIndex >= 0 && <span className="absolute -right-1 -top-1 grid size-3 place-items-center rounded-full bg-card text-[8px] text-primary ring-1 ring-primary">{selectedIndex + 1}</span>}
              </button>
            )
          })}
        </div>
        <p className="mt-1 flex items-center gap-1 px-1 text-[9px] font-mono text-muted-foreground" aria-live="polite">
          <ArrowUp className="size-3" />
          {announce || (selection.length === 2 ? `${selection.join(" + ")} · swipe up to add ${primaryModule?.name ?? "a matching node"}` : "pick two letters · swipe up to add")}
        </p>
      </div>
    </section>
  )
}
