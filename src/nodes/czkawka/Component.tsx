import type { NodeComponentProps } from "@xiranite/contract"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"

import type { CzkawkaCardState } from "./types"
import { useCzkawkaWorkbench } from "./use-czkawka-workbench"
import { Collapsed, Compact, Full } from "./views/CzkawkaWorkspaceView"

export function Component({ compId, host }: NodeComponentProps<CzkawkaCardState>) {
  "use no memo"
  const surface = useNodeSurface()
  const { t, language } = useNodeI18n("czkawka")
  const view = useCzkawkaWorkbench({ compId, host, surface, t, language })
  const compact = surface.mode === "compact" || surface.mode === "portrait" || surface.width < 760

  return (
    <TooltipProvider>
      <div ref={surface.ref} data-testid="czkawka-surface" data-surface-mode={surface.mode} data-surface-width={surface.width} data-host-theme={host.env.theme} className="@container/czkawka flex h-full min-h-0 w-full overflow-hidden bg-transparent text-foreground">
        {surface.mode === "collapsed" ? <Collapsed {...view} /> : compact ? <Compact {...view} /> : <Full {...view} />}
      </div>
    </TooltipProvider>
  )
}

export { scanInput } from "./views/model"
