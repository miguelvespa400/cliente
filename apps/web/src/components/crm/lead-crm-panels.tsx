"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Lead } from "@/hooks/use-leads";
import { TaskForm, TaskItem } from "./tasks";

/** Valor, responsável e previsão de fechamento do negócio. */
export function DealCard({ lead, onEdit }: { lead: Lead; onEdit: () => void }) {
  const rows = [
    { label: "Valor estimado", value: lead.dealValue != null ? formatCurrency(lead.dealValue) : null },
    { label: "Responsável", value: lead.owner?.name ?? null },
    { label: "Previsão de fechamento", value: lead.expectedCloseDate ? formatDate(lead.expectedCloseDate) : null },
    { label: "Pessoa de contato", value: lead.contactName ?? null },
  ];
  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Negócio</CardTitle>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}><Pencil className="w-3 h-3" />Editar</Button>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground text-xs">{r.label}</span>
            {r.value ? <span className="font-medium text-right">{r.value}</span> : (
              <button className="text-xs text-primary hover:underline" onClick={onEdit}>Definir</button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function TasksCard({ lead, onChanged }: { lead: Lead; onChanged: () => Promise<void> }) {
  const [showDone, setShowDone] = useState(false);
  const open = (lead.tasks ?? []).filter((t) => !t.done);
  const done = (lead.tasks ?? []).filter((t) => t.done);
  return (
    <Card id="tarefas" className="scroll-mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Tarefas {open.length > 0 && <span className="text-muted-foreground font-normal text-sm">({open.length})</span>}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <TaskForm leadId={lead.id} onCreated={onChanged} />
        {open.length > 0 ? (
          <div className="divide-y border-t">
            {open.map((t) => <TaskItem key={t.id} task={t} onChanged={onChanged} />)}
          </div>
        ) : (
          <p className="text-xs text-warning border-t pt-3">Nenhuma tarefa aberta: agende o próximo passo para não esquecer este lead.</p>
        )}
        {done.length > 0 && (
          <div>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowDone((v) => !v)}>
              <ChevronDown className={`w-3 h-3 transition-transform ${showDone ? "rotate-180" : ""}`} />
              {done.length} concluída{done.length > 1 ? "s" : ""}
            </button>
            {showDone && <div className="divide-y">{done.map((t) => <TaskItem key={t.id} task={t} onChanged={onChanged} />)}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function NotesCard({ lead, onSaved }: { lead: Lead; onSaved: () => Promise<void> }) {
  const [notes, setNotes] = useState(lead.crmNotes ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = notes.trim() !== (lead.crmNotes ?? "").trim();

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/leads/${lead.id}`, { crmNotes: notes.trim() });
      toast.success("Observações salvas");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Observações</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="O que o cliente precisa, objeções, combinados..."
          aria-label="Observações do lead"
        />
        {dirty && (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setNotes(lead.crmNotes ?? "")} disabled={saving}>Descartar</Button>
            <Button size="sm" variant="gradient" onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Salvar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
