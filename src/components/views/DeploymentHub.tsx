import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, MoreHorizontal, Plus, SlidersHorizontal } from "lucide-react"

interface Deployment {
  id: string
  type: "PRODUCTION" | "SANDBOX" | "CONCEPT_01" | "DATA_CORE"
  nameKey: string
  descKey: string
  uptime: string
  status: "SYNCED" | "UNSAVED" | "OFFLINE"
  image?: string
  data?: { labelKey: string; value: string }[]
}

const DEPLOYMENTS: Deployment[] = [
  {
    id: "d1",
    type: "PRODUCTION",
    nameKey: "view:deployment.deployments.alpha.name",
    descKey: "view:deployment.deployments.alpha.description",
    uptime: "99.9%",
    status: "SYNCED",
  },
  {
    id: "d2",
    type: "SANDBOX",
    nameKey: "view:deployment.deployments.beta.name",
    descKey: "view:deployment.deployments.beta.description",
    uptime: "85.2%",
    status: "UNSAVED",
  },
  {
    id: "d3",
    type: "CONCEPT_01",
    nameKey: "view:deployment.deployments.atmospheric.name",
    descKey: "view:deployment.deployments.atmospheric.description",
    uptime: "92.4%",
    status: "SYNCED",
    image: "/images/AP1WRLtFN30ibmP5BxueqqSoHPfy5dAhIzT4CxlYI0YZ5GdDiUy82SUmwslKYOwT04xUXjmRCmmaeqZWc62Bt83UDtz8AemMLqJN5_MsKM5zOdxHq7EI5rrH-0h1uJDw6Y2b2dPClojgibi7SjeFmCruk1xLH7yBuwc4U8KS20YKDDRFkJwRUgjJtOhewPH9FFnJfoIge88K82ubM_iGHAfruBCywpckjf3fqotL6_n3moR6vXMoyUGnzWo4A9Y=s2560",
  },
  {
    id: "d4",
    type: "DATA_CORE",
    nameKey: "view:deployment.deployments.logistics.name",
    descKey: "",
    uptime: "99.9%",
    status: "SYNCED",
    data: [
      { labelKey: "view:deployment.deployments.logistics.nodes", value: "01,248" },
      { labelKey: "view:deployment.deployments.logistics.edges", value: "08,402" },
    ],
  },
]

const STATUS_KEY: Record<Deployment["status"], string> = {
  SYNCED:  "view:deployment.status.synced",
  UNSAVED: "view:deployment.status.unsaved",
  OFFLINE: "view:deployment.status.offline",
}

const STATUS_DOT_CLASS: Record<Deployment["status"], string> = {
  SYNCED:  "bg-primary",
  UNSAVED: "bg-destructive",
  OFFLINE: "bg-muted-foreground",
}

const STATUS_TEXT_CLASS: Record<Deployment["status"], string> = {
  SYNCED:  "text-primary",
  UNSAVED: "text-destructive",
  OFFLINE: "text-muted-foreground",
}

const TYPE_KEY: Record<Deployment["type"], string> = {
  PRODUCTION: "view:deployment.type.production",
  SANDBOX: "view:deployment.type.sandbox",
  CONCEPT_01: "view:deployment.type.concept_01",
  DATA_CORE: "view:deployment.type.data_core",
}

export function DeploymentHub() {
  const { t } = useTranslation()
  const filtered = DEPLOYMENTS

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border/60 flex items-start justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t("view:deployment.title")}</h1>
          <p className="text-xs font-mono text-muted-foreground mt-1">
            {t("view:deployment.subtitle")} // <span className="text-primary">{t("view:deployment.systemOnline")}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 font-mono text-xs gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("view:deployment.filter")}
          </Button>
          <Button size="sm" className="h-8 font-mono text-xs gap-1.5 btn-primary-glow">
            <Plus className="h-3.5 w-3.5" />
            {t("view:deployment.newDeployment")}
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
  const { t } = useTranslation()
  return (
    <div className="group bg-card border border-border/60 rounded-sm overflow-hidden hover:border-border transition-all hover:shadow-sm">
      {/* Optional image */}
      {dep.image && (
        <div className="relative h-32 overflow-hidden">
          <img src={dep.image} alt={t(dep.nameKey)} className="w-full h-full object-cover opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
          <Badge variant="outline" className="absolute top-2 left-2 font-mono text-[9px] bg-card/80 backdrop-blur-sm">
            {t(TYPE_KEY[dep.type])}
          </Badge>
        </div>
      )}

      <div className="p-4">
        {!dep.image && (
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-sm bg-muted border border-border/50 flex items-center justify-center">
              <div className="w-2.5 h-2.5 border border-muted-foreground/50 rounded-sm" />
            </div>
            <Badge variant="outline" className="font-mono text-[9px]">{t(TYPE_KEY[dep.type])}</Badge>
            <button className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        )}

        {dep.image && (
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground">{t(dep.nameKey)}</h3>
            <button className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        )}

        {!dep.image && (
          <h3 className="text-sm font-semibold text-foreground mb-1">{t(dep.nameKey)}</h3>
        )}

        {dep.descKey && (
          <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2">{t(dep.descKey)}</p>
        )}

        {dep.data && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {dep.data.map(d => (
              <div key={d.labelKey} className="bg-muted/30 border border-border/40 rounded-sm px-3 py-2">
                <p className="text-[10px] font-mono text-muted-foreground">{t(d.labelKey)}</p>
                <p className="text-sm font-mono font-bold text-primary tabular-nums">{d.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="text-[10px] font-mono">{t("view:deployment.uptime", { uptime: dep.uptime })}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT_CLASS[dep.status])} />
            <span className={cn("text-[10px] font-mono", STATUS_TEXT_CLASS[dep.status])}>{t(STATUS_KEY[dep.status])}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
