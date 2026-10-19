"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useMembers, useTaskSummary, useTasks, type TaskBucket } from "@/hooks/use-crm";
import { TaskItem } from "./tasks";

const TABS: Array<{ id: TaskBucket; label: string; empty: string }> = [
  { id: "overdue", label: "Atrasadas", empty: "Nenhuma tarefa atrasada." },
  { id: "today", label: "Hoje", empty: "Nada mais para hoje." },
  { id: "upcoming", label: "Próximas", empty: "Nenhuma tarefa agendada para os próximos dias." },
  { id: "done", label: "Concluídas", empty: "Nenhuma tarefa concluída ainda." },
];

export function TasksPage() {
  const { user } = useAuth();
  const members = useMembers();
  const [owner, setOwner] = useState("all");
  const ownerId = owner === "all" ? undefined : owner === "me" ? user?.id : owner;
  const { summary } = useTaskSummary(ownerId);
  const [tab, setTab] = useState<TaskBucket | null>(null);
  // Abre em "Atrasadas" se houver alguma; senão em "Hoje".
  const active: TaskBucket = tab ?? (summary?.overdue ? "overdue" : "today");
  const { tasks, loading, refresh } = useTasks({ status: active, ownerId });

  const count = (id: TaskBucket) => (id === "done" || id === "open" ? null : summary?.[id] ?? null);
  const current = TABS.find((t) => t.id === active)!;

  return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border bg-muted/40 p-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={active === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active === t.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {count(t.id) ? (
                <span className={cn(
                  "rounded-full px-1.5 text-[11px] leading-5",
                  t.id === "overdue" ? "bg-destructive text-destructive-foreground" : "bg-primary/15 text-primary",
                )}>{count(t.id)}</span>
              ) : null}
            </button>
          ))}
        </div>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="w-48 ml-auto" aria-label="Responsável"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda a equipe</SelectItem>
            <SelectItem value="me">Só as minhas</SelectItem>
            {members.filter((m) => m.user.id !== user?.id).map((m) => (
              <SelectItem key={m.user.id} value={m.user.id}>{m.user.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="py-2 divide-y">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 py-3"><Skeleton className="h-4 w-4" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>
            ))
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <div className="rounded-full bg-muted p-3">
                {active === "overdue" || active === "today" ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Inbox className="h-5 w-5 text-muted-foreground" />}
              </div>
              <p className="text-sm font-medium">{current.empty}</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Para agendar, abra um lead e use o quadro “Tarefas”, ou mova os cards no funil.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-1"><Link href="/pipeline">Abrir o funil</Link></Button>
            </div>
          ) : (
            tasks.map((t) => <TaskItem key={t.id} task={t} showLead onChanged={refresh} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
