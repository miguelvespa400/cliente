"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";

interface Content {
  email?: { subject: string; body: string };
  whatsapp?: string;
  instagram?: string;
}

/** Edição manual da abordagem do lead. O e-mail editado aqui tem prioridade sobre o texto padrão da campanha. */
export function LeadContentDialog({ leadId, content, onClose, onSaved }: { leadId: string; content: Content; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState(content.email?.subject ?? "");
  const [body, setBody] = useState(content.email?.body ?? "");
  const [whatsapp, setWhatsapp] = useState(content.whatsapp ?? "");
  const [instagram, setInstagram] = useState(content.instagram ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const emailChanged = subject !== (content.email?.subject ?? "") || body !== (content.email?.body ?? "");
      await api.patch(`/leads/${leadId}/content`, {
        ...(emailChanged ? { emailSubject: subject, emailBody: body } : {}),
        whatsapp,
        instagram,
      });
      toast.success("Textos salvos");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar abordagem</DialogTitle>
          <DialogDescription>
            O e-mail editado aqui é o que será enviado para este lead, mesmo que a campanha tenha um texto padrão.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="lc-subject">Assunto do e-mail</Label>
            <Input id="lc-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lc-body">Mensagem do e-mail</Label>
            <Textarea id="lc-body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lc-wa">WhatsApp</Label>
            <Textarea id="lc-wa" rows={4} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lc-ig">Instagram (DM)</Label>
            <Textarea id="lc-ig" rows={3} value={instagram} onChange={(e) => setInstagram(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="gradient" onClick={save} disabled={saving || !subject.trim() || !body.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
