"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, CheckCircle2, Eye, MousePointerClick, Reply, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

interface EmailEvent {
  id: string;
  type: string;
  data: { link?: string; text?: string; from?: string; bounceType?: string } | null;
  occurredAt: string;
}

interface EmailMessage {
  id: string;
  toEmail: string;
  subject: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  firstOpenedAt: string | null;
  openCount: number;
  firstClickedAt: string | null;
  clickCount: number;
  repliedAt: string | null;
  events: EmailEvent[];
}

const STATUS: Record<string, { label: string; variant: "secondary" | "success" | "destructive" | "info" }> = {
  queued: { label: "Na fila", variant: "secondary" },
  sent: { label: "Enviado", variant: "info" },
  delivered: { label: "Entregue", variant: "success" },
  bounced: { label: "Devolvido", variant: "destructive" },
  complained: { label: "Marcado como spam", variant: "destructive" },
  failed: { label: "Falhou", variant: "destructive" },
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

/** Envio pelo Amazon SES + funil do e-mail (entregue → aberto → clicado → respondeu). */
export function LeadEmailPanel({ leadId, hasEmail, onSent }: { leadId: string; hasEmail: boolean; onSent: () => void }) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setMessages(await api.get<EmailMessage[]>(`/email/leads/${leadId}`).catch(() => []));
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (messages.length > 0 && !window.confirm("Este lead já recebeu um e-mail. Enviar de novo?")) return;
    setSending(true);
    try {
      await api.post(`/email/leads/${leadId}/send`, {});
      toast.success("E-mail enviado");
      await load();
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no envio");
      await load();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button size="sm" variant="gradient" className="h-7 text-xs" onClick={send} disabled={sending || !hasEmail} title={hasEmail ? undefined : "Lead sem e-mail"}>
        {sending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Mail className="w-3 h-3 mr-1" />}
        Enviar pelo Amazon SES
      </Button>

      {messages.map((m) => {
        const st = STATUS[m.status] ?? { label: m.status, variant: "secondary" as const };
        const reply = m.events.find((e) => e.type === "reply");
        const clicks = m.events.filter((e) => e.type === "click");
        return (
          <div key={m.id} className="border rounded-lg p-3 text-xs space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={st.variant} className="text-[10px]">{st.label}</Badge>
              <span className="text-muted-foreground truncate">{m.toEmail} · {fmt(m.sentAt)}</span>
            </div>
            {m.error && (
              <p className="text-destructive flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />{m.error}</p>
            )}
            <div className="flex items-center gap-4 flex-wrap text-muted-foreground">
              <span className={m.deliveredAt ? "text-success" : ""}><CheckCircle2 className="inline w-3 h-3 mr-1" />Entregue {fmt(m.deliveredAt)}</span>
              <span className={m.firstOpenedAt ? "text-info" : ""} title="Estimativa: o Apple Mail abre sozinho e o Outlook bloqueia imagens">
                <Eye className="inline w-3 h-3 mr-1" />Aberto {m.openCount > 0 ? `${m.openCount}× · ${fmt(m.firstOpenedAt)}` : "—"}
              </span>
              <span className={m.firstClickedAt ? "text-warning" : ""}>
                <MousePointerClick className="inline w-3 h-3 mr-1" />Clicou {m.clickCount > 0 ? `${m.clickCount}× · ${fmt(m.firstClickedAt)}` : "—"}
              </span>
              <span className={m.repliedAt ? "text-success font-medium" : ""}>
                <Reply className="inline w-3 h-3 mr-1" />Respondeu {m.repliedAt ? fmt(m.repliedAt) : "—"}
              </span>
            </div>
            {clicks.length > 0 && (
              <p className="text-muted-foreground break-all">Links clicados: {[...new Set(clicks.map((c) => c.data?.link).filter(Boolean))].join(", ")}</p>
            )}
            {reply?.data?.text && (
              <div className="bg-success/10 rounded p-2 whitespace-pre-wrap">
                <p className="font-medium mb-1">{reply.data.from}</p>
                {reply.data.text}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
