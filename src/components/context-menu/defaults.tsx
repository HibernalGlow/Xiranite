import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import {
  Copy,
  Trash2,
  Maximize2,
  Minimize2,
  Expand,
  ExternalLink,
  Focus,
  Layers,
} from "lucide-react"
import { useWorkspaceActions } from "@/store/workspaceContext"
import { useWindowControls } from "@/hooks/useWindowControls"
import { useContextMenuBuilder, type ContextMenuItemDef } from "./ContextMenuProvider"

/**
 * Registers default context-menu builders for built-in scopes.
 * Call this once from the workspace layout root.
 *
 * Scopes:
 *  - `component-card`: actions for a component instance (data-component-id)
 */
export function useDefaultContextMenuItems() {
  const actions = useWorkspaceActions()
  const { openComponent } = useWindowControls()
  const { t } = useTranslation()

  const componentCardBuilder = useCallback(
    (ctx: { data: Record<string, string> }): ContextMenuItemDef[] => {
      const id = ctx.data.componentId
      if (!id) return []
      return [
        {
          label: t("contextMenu:focus"),
          icon: <Focus className="h-4 w-4" />,
          onSelect: () => actions.focusComponent(id),
        },
        {
          label: t("contextMenu:fullscreen"),
          icon: <Maximize2 className="h-4 w-4" />,
          onSelect: () => actions.setFullscreen(id),
        },
        {
          label: t("contextMenu:exitFullscreen"),
          icon: <Minimize2 className="h-4 w-4" />,
          onSelect: () => actions.setFullscreen(null),
        },
        { type: "separator" },
        {
          label: t("contextMenu:openWindow"),
          icon: <ExternalLink className="h-4 w-4" />,
          onSelect: () => {
            const comp = actions // need component lookup; actions has removeComponent but we need moduleId
            void comp
            void openComponent
            // openComponent needs moduleId + title; builder doesn't have store state for comp lookup.
            // Kept as a stub — callers with richer context can override.
          },
          disabled: true,
        },
        {
          label: t("contextMenu:duplicate"),
          icon: <Copy className="h-4 w-4" />,
          onSelect: () => {
            // Duplicate not yet in store; stub for future.
          },
          disabled: true,
        },
        { type: "separator" },
        {
          label: t("contextMenu:compact"),
          icon: <Layers className="h-4 w-4" />,
          onSelect: () => actions.setCardLayout("grid"),
        },
        {
          label: t("contextMenu:expand"),
          icon: <Expand className="h-4 w-4" />,
          onSelect: () => actions.setCardLayout("focus"),
        },
        { type: "separator" },
        {
          label: t("contextMenu:delete"),
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => actions.removeComponent(id),
        },
      ]
    },
    [actions, openComponent, t],
  )

  useContextMenuBuilder("component-card", componentCardBuilder)
}
