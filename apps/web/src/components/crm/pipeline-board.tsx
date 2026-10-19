"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Plus, MoreHorizontal, CalendarClock, User2, Megaphone, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { CRM_STAGES, TASK_TYPE_LABELS } from "@/lib/labels";
import { cn, formatCurrency, getInitials } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useMembers, usePipeline, type PipelineLead, type PipelineStage } from "@/hooks/use-crm";
import type { CrmStatus } from "@/hooks/use-leads";
import { LeadFormDialog } from "./lead-form-dialog";
import { TASK_ICONS, whenLabel } from "./tasks";

const PRIORITY_DOT: Record<string, string> = { HIGH: "bg-emerald-500", MEDIUM: "bg-amber-500", LOW: "bg-slate-300" };
const PRIORITY_PT: Record<string, string> = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };

/** Move o card entre colunas sem esperar a API (ajusta contagem e soma das duas etapas). */
function moveLocally(stages: PipelineStage[], lead: PipelineLead, to: CrmStatus): PipelineStage[] {
  const value = lead.dealValue ?? 0;
  return stages.map((s) => {
    if (s.status === lead.crmStatus) {
      return { ...s, count: s.count - 1, value: s.value - value, leads: s.leads.filter((l) => l.id !== lead.id) };
    }
    if (s.status === to) {
      return { ...s, count: s.count + 1, value: s.value + value, leads: [{ ...lead, crmStatus: to }, ...s.leads] };
    }
    return s;
  });
}

export function PipelineBoard() {
  const router = useRouter();
  const { user } = useAuth();
  const members = useMembers();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("all");
  const ownerId = owner === "all" ? undefined : owner === "me" ? user?.id : owner;
  const { stages, setStages, loading, error, refresh } = usePipeline({ ownerId, q: q || undefined });
  const [creating, setCreating] = useState<CrmStatus | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<CrmStatus | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onSearch = (value: string) => {
    setSearch(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQ(value.trim()), 350);
  };

  const move = useCallback(async (lead: PipelineLead, to: CrmStatus) => {
    if (lead.crmStatus === to) return;
    const label = CRM_STAGES.find((s) => s.status === to)?.label ?? to;
    setStages((prev) => moveLocally(prev, lead, to));
    try {
      await api.patch(`/leads/${lead.id}/crm`, { crmStatus: to });
      toast.success(to === "won" ? `🎉 ${lead.name}: negócio ganho!` : `${lead.name} → ${label}`, {
        action: to === "won" || to === "lost" ? undefined : {
          label: "Agendar próxima tarefa",
          onClick: () => router.push(`/leads/detalhe?id=${lead.id}#tarefas`),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível mover o lead");
      void refresh();
    }
  }, [refresh, router, setStages]);

  const findLead = (id: string) => stages.flatMap((s) => s.leads).find((l) => l.id === id);
  const openStages = stages.filter((s) => s.status !== "won" && s.status !== "lost");
  const openValue = openStages.reduce((sum, s) => sum + s.value, 0);
  const openCount = openStages.reduce((sum, s) => sum + s.count, 0);
  const won = stages.find((s) => s.status === "won");

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar no funil..." value={search} onChange={(e) => onSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="w-48" aria-label="Responsável"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda a equipe</SelectItem>
            <SelectItem value="me">Só os meus</SelectItem>
            {members.filter((m) => m.user.id !== user?.id).map((m) => (
              <SelectItem key={m.user.id} value={m.user.id}>{m.user.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-4 text-sm ml-auto">
          {!loading && (
            <>
              <span className="text-muted-foreground">
                Em negociação: <b className="text-foreground">{formatCurrency(openValue)}</b> ({openCount})
              </span>
              <span className="text-muted-foreground hidden sm:inline">
                Ganhos: <b className="text-success">{formatCurrency(won?.value ?? 0)}</b> ({won?.count ?? 0})
              </span>
            </>
          )}
          <Button variant="gradient" onClick={() => setCreating("new")}>
            <Plus className="h-4 w-4" />Novo lead
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 text-destructive" />{error}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => refresh()}><RefreshCw className="h-3.5 w-3.5" />Tentar de novo</Button>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6 snap-x">
        {CRM_STAGES.map((meta) => {
          const stage = stages.find((s) => s.status === meta.status);
          const status = meta.status as CrmStatus;
          return (
            <section
              key={meta.status}
              aria-label={`Etapa ${meta.label}`}
              className={cn(
                "flex w-72 flex-shrink-0 snap-start flex-col rounded-xl border bg-muted/30 transition-colors",
                over === status && dragId && "border-primary bg-primary/5",
              )}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setOver(status); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
              onDrop={(e) => {
                e.preventDefault();
                const lead = findLead(e.dataTransfer.getData("text/plain"));
                setOver(null);
                setDragId(null);
                if (lead) void move(lead, status);
              }}
            >
              <header className="flex items-start gap-2 px-3 pt-3 pb-2">
                <span className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", meta.dot)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-sm font-semibold">{meta.label}</h2>
                    <span className="text-xs text-muted-foreground">{stage?.count ?? 0}</span>
                  </div>
                  <p className="text-xs text-muted-foreground min-h-4">{stage?.value ? formatCurrency(stage.value, true) : ""}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Novo lead em ${meta.label}`} onClick={() => setCreating(status)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </header>

              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2 max-h-[calc(100vh-17rem)] min-h-[120px]">
                {loading ? (
                  Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)
                ) : stage?.leads.length ? (
                  <>
                    {stage.leads.map((lead) => (
                      <PipelineCard
                        key={lead.id}
                        lead={lead}
                        dragging={dragId === lead.id}
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", lead.id); e.dataTransfer.effectAllowed = "move"; setDragId(lead.id); }}
                        onDragEnd={() => { setDragId(null); setOver(null); }}
                        onMove={(to) => move(lead, to)}
                      />
                    ))}
                    {stage.count > stage.leads.length && (
                      <p className="px-1 py-2 text-center text-xs text-muted-foreground">
                        +{stage.count - stage.leads.length} mais antigos. Use a busca para encontrar.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                    {dragId ? "Solte aqui" : "Nenhum lead nesta etapa"}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {creating && (
        <LeadFormDialog
          defaultStatus={creating}
          onClose={() => setCreating(null)}
          onSaved={() => refresh()}
        />
      )}
    </div>
  );
}

function PipelineCard({
  lead, dragging, onDragStart, onDragEnd, onMove,
}: {
  lead: PipelineLead;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMove: (to: CrmStatus) => void;
}) {
  const task = lead.nextTask;
  const TaskIcon = task ? TASK_ICONS[task.type] ?? CalendarClock : CalendarClock;
  const overdue = task && new Date(task.scheduledAt).getTime() < Date.now();
  // "Sem próxima tarefa" só nas etapas em andamento (Novo pode ter centenas de leads das campanhas).
  const active = !["new", "won", "lost"].includes(lead.crmStatus);

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-grab rounded-lg border bg-card p-3 shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", PRIORITY_DOT[lead.priority])} title={`Prioridade ${PRIORITY_PT[lead.priority]}`} />
        <div className="flex-1 min-w-0">
          <Link href={`/leads/detalhe?id=${lead.id}`} draggable={false} className="block truncate text-sm font-medium hover:text-primary hover:underline">
            {lead.name}
          </Link>
          {lead.contactName && <p className="truncate text-xs text-muted-foreground">{lead.contactName}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="-mr-1 -mt-1 h-6 w-6 opacity-50 group-hover:opacity-100" aria-label={`Ações de ${lead.name}`}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild><Link href={`/leads/detalhe?id=${lead.id}`}>Abrir lead</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Mover para</DropdownMenuLabel>
            {CRM_STAGES.filter((s) => s.status !== lead.crmStatus).map((s) => (
              <DropdownMenuItem key={s.status} onClick={() => onMove(s.status as CrmStatus)}>
                <span className={cn("mr-2 h-2 w-2 rounded-full", s.dot)} />{s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={cn("text-sm font-semibold", lead.dealValue ? "text-foreground" : "text-muted-foreground font-normal text-xs")}>
          {lead.dealValue ? formatCurrency(lead.dealValue) : "Sem valor"}
        </span>
        {lead.owner ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-brand text-[10px] font-semibold text-white" title={`Responsável: ${lead.owner.name}`}>
            {getInitials(lead.owner.name)}
          </span>
        ) : (
          <User2 className="h-4 w-4 text-muted-foreground/50" aria-label="Sem responsável" />
        )}
      </div>

      {task ? (
        <p className={cn("mt-2 flex items-center gap-1 truncate text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}
          title={`${TASK_TYPE_LABELS[task.type] ?? "Tarefa"}: ${task.note}`}>
          <TaskIcon className="h-3 w-3 flex-shrink-0" />{whenLabel(task.scheduledAt)} · {task.note}
        </p>
      ) : active ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-warning"><CalendarClock className="h-3 w-3" />Sem próxima tarefa</p>
      ) : null}

      {lead.campaign && (
        <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground/80"><Megaphone className="h-3 w-3" />{lead.campaign.name}</p>
      )}
    </article>
  );
}
