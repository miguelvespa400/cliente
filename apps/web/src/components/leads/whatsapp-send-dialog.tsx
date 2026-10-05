"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";

// Envio pela WhatsApp Cloud API (integração "whatsapp" conectada em Integrações).
// Modelo aprovado: obrigatório no 1º contato. Texto livre: só se a empresa escreveu nas últimas 24 h.
export function WhatsAppSendDialog({
  leadId,
  leadName,
  phone,
  message,
  templateName,
  onClose,
  onSent,
}: {
  leadId: string;
  leadName: string;
  phone: string;
  message: string;
  templateName?: string;
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"template" | "text">("template");
  const [text, setText] = useState(message);
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      await api.post(`/integrations/whatsapp/send/${leadId}`, { mode, text });
      toast.success(`WhatsApp enviado para ${leadName}`);
      await onSent();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar WhatsApp para {leadName}</DialogTitle>
          <DialogDescription>Para {phone}, pela API oficial do WhatsApp Business.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="radio" className="mt-1 accent-[hsl(var(--primary))]" checked={mode === "template"} onChange={() => setMode("template")} />
              <span>
                <b>Modelo aprovado</b>{templateName ? ` (${templateName})` : ""}: use no primeiro contato.
                <span className="block text-xs text-muted-foreground">A mensagem abaixo entra no lugar da variável do modelo, em uma linha só.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="radio" className="mt-1 accent-[hsl(var(--primary))]" checked={mode === "text"} onChange={() => setMode("text")} />
              <span>
                <b>Texto livre</b>: só funciona se a empresa escreveu para você nas últimas 24 horas.
              </span>
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-text">Mensagem</Label>
            <Textarea id="wa-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancelar</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={send} disabled={sending || !text.trim()}>
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-2" />}Enviar agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
