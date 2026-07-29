import { NodeAppSurface, type NodeAppProps } from "./StandaloneNodeApp"
import { useDirectNodeAppSessionState } from "./nodeAppState"

export function DirectNodeApp(props: NodeAppProps) {
  return (
    <NodeAppSurface
      {...props}
      componentIdPrefix="direct-node"
      useStateController={useDirectNodeAppSessionState}
    />
  )
}
