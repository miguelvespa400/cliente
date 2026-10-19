"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { CRM_STAGES } from "@/lib/labels";
import { dateInputToIso, isoToDateInput } from "@/lib/utils";
import { useMembers } from "@/hooks/use-crm";
import type { Lead } from "@/hooks/use-leads";

const NONE = "none";

/** Aceita "5000", "5.000", "5.000,50" e "5000.50". "" = sem valor. Inválido = undefined. */
export function parseMoney(text: string): number | null | undefined {
  const t = text.replace(/[R$\s]/g, "");
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const moneyText = (v: number | null | undefined) =>
  v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });

type Form = {
  name: string; contactName: string; phone: string; email: string; website: string; address: string; category: string;
  dealValue: string; ownerId: string; expectedCloseDate: string; crmStatus: string; priority: string; crmNotes: string;
};

/** Cadastro manual (sem `lead`) ou edição dos dados do lead e do negócio. */
export function LeadFormDialog({
  lead,
  defaultStatus = "new",
  onClose,
  onSaved,
}: {
  lead?: Lead;
  defaultStatus?: string;
  onClose: () => void;
  onSaved: (lead: Lead) => void | Promise<void>;
}) {
  const members = useMembers();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Form>({
    name: lead?.name ?? "",
    contactName: lead?.contactName ?? "",
    phone: lead?.phone ?? "",
    email: lead?.email ?? "",
    website: lead?.website ?? "",
    address: lead?.address ?? "",
    category: lead?.category ?? "",
    dealValue: moneyText(lead?.dealValue),
    ownerId: lead ? lead.ownerId ?? NONE : "",
    expectedCloseDate: isoToDateInput(lead?.expectedCloseDate),
    crmStatus: lead?.crmStatus ?? defaultStatus,
    priority: lead?.priority ?? "MEDIUM",
    crmNotes: lead?.crmNotes ?? "",
  });
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dealValue = parseMoney(form.dealValue);

  const save = async () => {
    if (!form.name.trim()) return toast.error("Informe o nome da empresa ou do cliente");
    if (dealValue === undefined) return toast.error("Valor inválido. Use, por exemplo, 5.000 ou 5000,50");
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      contactName: form.contactName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      website: form.website.trim(),
      address: form.address.trim(),
      category: form.category.trim(),
      dealValue,
      expectedCloseDate: dateInputToIso(form.expectedCloseDate),
      priority: form.priority,
      crmNotes: form.crmNotes.trim(),
      // Cadastro sem escolha de responsável: a API atribui a quem cadastrou.
      ...(form.ownerId !== "" && { ownerId: form.ownerId === NONE ? null : form.ownerId }),
      ...(!lead && { crmStatus: form.crmStatus }),
    };
    try {
      const saved = lead ? await api.patch<Lead>(`/leads/${lead.id}`, payload) : await api.post<Lead>("/leads", payload);
      toast.success(lead ? "Lead atualizado" : `${saved.name} cadastrado`);
      await onSaved(saved);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lead ? "Editar lead" : "Novo lead"}</DialogTitle>
          <DialogDescription>
            {lead ? "Dados de contato e do negócio." : "Cadastre um cliente que não veio das campanhas (indicação, telefone, evento...)."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          onSubmit={(e) => { e.preventDefault(); void save(); }}
        >
          <Field label="Empresa ou cliente *" className="sm:col-span-2">
            <Input autoFocus value={form.name} onChange={set("name")} placeholder="Ex.: Padaria Pão Quente" maxLength={200} />
          </Field>
          <Field label="Pessoa de contato">
            <Input value={form.contactName} onChange={set("contactName")} placeholder="Ex.: Maria (dona)" />
          </Field>
          <Field label="Telefone / WhatsApp">
            <Input value={form.phone} onChange={set("phone")} placeholder="(11) 99999-9999" inputMode="tel" />
          </Field>
          <Field label="E-mail">
            <Input type="email" value={form.email} onChange={set("email")} placeholder="contato@empresa.com.br" />
          </Field>
          <Field label="Site ou Instagram">
            <Input value={form.website} onChange={set("website")} placeholder="https://..." />
          </Field>
          <Field label="Endereço" className="sm:col-span-2">
            <Input value={form.address} onChange={set("address")} placeholder="Rua, número, bairro, cidade" />
          </Field>

          <div className="sm:col-span-2 border-t pt-4 -mb-1">
            <p className="text-sm font-semibold">Negócio</p>
          </div>
          <Field label="Valor estimado (R$)">
            <Input value={form.dealValue} onChange={set("dealValue")} placeholder="Ex.: 3.500" inputMode="decimal" aria-invalid={dealValue === undefined} />
          </Field>
          <Field label="Previsão de fechamento">
            <Input type="date" value={form.expectedCloseDate} onChange={set("expectedCloseDate")} />
          </Field>
          <Field label="Responsável">
            <Select value={form.ownerId || "auto"} onValueChange={(v) => setForm((f) => ({ ...f, ownerId: v === "auto" ? "" : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {!lead && <SelectItem value="auto">Eu (quem está cadastrando)</SelectItem>}
                <SelectItem value={NONE}>Sem responsável</SelectItem>
                {members.map((m) => <SelectItem key={m.user.id} value={m.user.id}>{m.user.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Prioridade">
            <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="HIGH">Alta</SelectItem>
                <SelectItem value="MEDIUM">Média</SelectItem>
                <SelectItem value="LOW">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {!lead && (
            <Field label="Etapa do funil">
              <Select value={form.crmStatus} onValueChange={(v) => setForm((f) => ({ ...f, crmStatus: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CRM_STAGES.map((s) => <SelectItem key={s.status} value={s.status}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Segmento">
            <Input value={form.category} onChange={set("category")} placeholder="Ex.: Restaurante" />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea rows={3} value={form.crmNotes} onChange={set("crmNotes")} placeholder="Como chegou, o que precisa, objeções..." />
          </Field>

          <DialogFooter className="sm:col-span-2 gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" variant="gradient" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{lead ? "Salvar" : "Cadastrar lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// <label> envolvendo o campo: associa o rótulo sem precisar de id.
function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block space-y-1.5 ${className ?? ""}`}>
      <span className="text-sm font-medium leading-none">{label}</span>
      {children}
    </label>
  );
}
