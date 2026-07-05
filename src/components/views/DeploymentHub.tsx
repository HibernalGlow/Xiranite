import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, MoreHorizontal, Plus, SlidersHorizontal } from "lucide-react"

interface Deployment {
  id: string
  type: "PRODUCTION" | "SANDBOX" | "CONCEPT_01" | "DATA_CORE"
  name: string
  description: string
  uptime: string
  status: "SYNCED" | "UNSAVED" | "OFFLINE"
  image?: string
  data?: { label: string; value: string }[]
}

const DEPLOYMENTS: Deployment[] = [
  {
    id: "d1",
    type: "PRODUCTION",
    name: "Alpha Core System",
    description: "Main deployment environment for the Alpha initiative. Requires strict access protocols.",
    uptime: "99.9%",
    status: "SYNCED",
  },
  {
    id: "d2",
    type: "SANDBOX",
    name: "Beta Feature Test",
    description: "Experimental UI components and layout variations for the upcoming Q3 release.",
    uptime: "85.2%",
    status: "UNSAVED",
  },
  {
    id: "d3",
    type: "CONCEPT_01",
    name: "Atmospheric Urban UI",
    description: "Visual explorations for the new design system update focusing on tonal depth an...",
    uptime: "92.4%",
    status: "SYNCED",
    image: "/images/AP1WRLtFN30ibmP5BxueqqSoHPfy5dAhIzT4CxlYI0YZ5GdDiUy82SUmwslKYOwT04xUXjmRCmmaeqZWc62Bt83UDtz8AemMLqJN5_MsKM5zOdxHq7EI5rrH-0h1uJDw6Y2b2dPClojgibi7SjeFmCruk1xLH7yBuwc4U8KS20YKDDRFkJwRUgjJtOhewPH9FFnJfoIge88K82ubM_iGHAfruBCywpckjf3fqotL6_n3moR6vXMoyUGnzWo4A9Y=s2560",
  },
  {
    id: "d4",
    type: "DATA_CORE",
    name: "Global Logistics Model",
    description: "",
    uptime: "99.9%",
    status: "SYNCED",
    data: [
      { label: "NODES", value: "01,248" },
      { label: "EDGES", value: "08,402" },
    ],
  },
]

const STATUS_CLASSES: Record<Deployment["status"], string> = {
  SYNCED:  "text-primary",
  UNSAVED: "text-destructive",
  OFFLINE: "text-muted-foreground",
}

export function DeploymentHub() {
  const filtered = DEPLOYMENTS

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border/60 flex items-start justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Deployment Hub</h1>
          <p className="text-xs font-mono text-muted-foreground mt-1">
            Active production environments and sandboxes // <span className="text-primary">SYSTEM.ONLINE</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 font-mono text-xs gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            FILTER
          </Button>
          <Button size="sm" className="h-8 font-mono text-xs gap-1.5 btn-primary-glow">
            <Plus className="h-3.5 w-3.5" />
            NEW DEPLOYMENT
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(dep => (
            <DeploymentCard key={dep.id} dep={dep} />
          ))}
        </div>
      </div>
    </div>
  )
}

function DeploymentCard({ dep }: { dep: Deployment }) {
  return (
    <div className="group bg-card border border-border/60 rounded-sm overflow-hidden hover:border-border transition-all hover:shadow-sm">
      {/* Optional image */}
      {dep.image && (
        <div className="relative h-32 overflow-hidden">
          <img src={dep.image} alt={dep.name} className="w-full h-full object-cover opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
          <Badge variant="outline" className="absolute top-2 left-2 font-mono text-[9px] bg-card/80 backdrop-blur-sm">
            {dep.type}
          </Badge>
        </div>
      )}

      <div className="p-4">
        {!dep.image && (
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-sm bg-muted border border-border/50 flex items-center justify-center">
              <div className="w-2.5 h-2.5 border border-muted-foreground/50 rounded-sm" />
            </div>
            <Badge variant="outline" className="font-mono text-[9px]">{dep.type}</Badge>
            <button className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        )}

        {dep.image && (
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground">{dep.name}</h3>
            <button className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        )}

        {!dep.image && (
          <h3 className="text-sm font-semibold text-foreground mb-1">{dep.name}</h3>
        )}

        {dep.description && (
          <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2">{dep.description}</p>
        )}

        {dep.data && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {dep.data.map(d => (
              <div key={d.label} className="bg-muted/30 border border-border/40 rounded-sm px-3 py-2">
                <p className="text-[10px] font-mono text-muted-foreground">{d.label}</p>
                <p className="text-sm font-mono font-bold text-primary tabular-nums">{d.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="text-[10px] font-mono">UP: {dep.uptime}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn("w-1.5 h-1.5 rounded-full", dep.status === "SYNCED" ? "bg-primary" : dep.status === "UNSAVED" ? "bg-destructive" : "bg-muted-foreground")} />
            <span className={cn("text-[10px] font-mono", STATUS_CLASSES[dep.status])}>{dep.status}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
