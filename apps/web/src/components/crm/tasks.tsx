"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Phone, MessageCircle, Mail, CalendarDays, MapPin, CheckSquare, Trash2, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { TASK_TYPE_LABELS } from "@/lib/labels";
import { cn, isoToDateTimeInput } from "@/lib/utils";
import { notifyTasksChanged } from "@/hooks/use-crm";
import type { Task } from "@/hooks/use-leads";

export const TASK_ICONS: Record<string, typeof Phone> = {
  call: Phone, whatsapp: MessageCircle, email: Mail, meeting: CalendarDays, visit: MapPin, other: CheckSquare,
};

/** "Hoje 14:00", "Amanhã 09:00", "seg., 20/10 09:00". */
export function whenLabel(iso: string) {
  const d = new Date(iso);
  const day = (x: Date) => x.toDateString();
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const yesterday = new Date(Date.now() - 86_400_000);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (day(d) === day(today)) return `Hoje ${time}`;
  if (day(d) === day(tomorrow)) return `Amanhã ${time}`;
  if (day(d) === day(yesterday)) return `Ontem ${time}`;
  return `${d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} ${time}`;
}

export function TaskItem({ task, showLead, onChanged }: { task: Task; showLead?: boolean; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const Icon = TASK_ICONS[task.type] ?? CheckSquare;
  const overdue = !task.done && new Date(task.scheduledAt).getTime() < Date.now();

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      notifyTasksChanged();
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar a tarefa");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("group flex items-start gap-3 py-2.5", task.done && "opacity-60")}>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 flex-shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
        checked={task.done}
        disabled={busy}
        aria-label={task.done ? "Reabrir tarefa" : "Concluir tarefa"}
        onChange={() => run(() => api.patch(`/tasks/${task.id}`, { done: !task.done }), task.done ? "Tarefa reaberta" : "Tarefa concluída")}
      />
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm leading-snug", task.done && "line-through")}>{task.note}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Icon className="w-3 h-3" />{TASK_TYPE_LABELS[task.type] ?? "Tarefa"}</span>
          <span className={cn(overdue && "font-medium text-destructive")}>{overdue ? "Atrasada · " : ""}{whenLabel(task.scheduledAt)}</span>
          {showLead && task.lead && (
            <Link href={`/leads/detalhe?id=${task.leadId}`} className="font-medium text-foreground hover:text-primary hover:underline truncate max-w-[220px]">
              {task.lead.name}
            </Link>
          )}
          {showLead && task.lead?.owner && <span>· {task.lead.owner.name}</span>}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100"
        disabled={busy}
        aria-label="Excluir tarefa"
        onClick={() => run(() => api.delete(`/tasks/${task.id}`), "Tarefa excluída")}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );
}

function at(daysFromToday: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, 0, 0, 0);
  return isoToDateTimeInput(d.toISOString());
}

const QUICK = [
  { label: "Hoje 17h", value: () => at(0, 17) },
  { label: "Amanhã 9h", value: () => at(1, 9) },
  { label: "Em 3 dias", value: () => at(3, 9) },
  { label: "Próx. semana", value: () => at(7, 9) },
];

export function TaskForm({ leadId, onCreated }: { leadId: string; onCreated: () => void | Promise<void> }) {
  const [type, setType] = useState("call");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(() => at(1, 9));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!note.trim()) return toast.error("Descreva a tarefa");
    if (!when) return toast.error("Escolha a data e a hora");
    setSaving(true);
    try {
      await api.post("/tasks", { leadId, type, note: note.trim(), scheduledAt: new Date(when).toISOString() });
      toast.success("Tarefa agendada");
      setNote("");
      notifyTasksChanged();
      await onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível agendar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="flex gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[120px] h-9 flex-shrink-0" aria-label="Tipo de tarefa"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(TASK_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="h-9" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Ligar para apresentar a proposta" maxLength={500} aria-label="Descrição da tarefa" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input type="datetime-local" className="h-8 w-auto text-xs" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Data e hora" />
        {QUICK.map((q) => (
          <Button key={q.label} type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setWhen(q.value())}>{q.label}</Button>
        ))}
        <Button type="submit" size="sm" variant="gradient" className="h-8 ml-auto" disabled={saving}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Agendar
        </Button>
      </div>
    </form>
  );
}
