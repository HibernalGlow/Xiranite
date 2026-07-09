import type { NodeComponentProps } from "@xiranite/contract"
import type { PackuCardState } from "./types"
import { PackuWorkbench } from "@/nodes/shared/packu/Workbench"
import { NODE_META } from "./constants"

export function Component({ compId, host }: NodeComponentProps<PackuCardState>) {
  return <PackuWorkbench compId={compId} host={host} meta={NODE_META} />
}
