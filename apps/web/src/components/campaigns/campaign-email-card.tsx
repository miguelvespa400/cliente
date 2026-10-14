"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, Search, Send } from "lucide-react";
import { api } from "@/lib/api";

interface EmailStats {
  configured: boolean;
  leadsWithEmail: number;
  eligible: number;
  sentToday: number;
  dailyLimit: number;
  queued: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  complained: number;
  failed: number;
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

/** Funil de e-mail da campanha + envio em lote pelo Amazon SES. */
export function CampaignEmailCard({ campaignId, totalLeads, onLeadsChanged }: { campaignId: string; totalLeads: number; onLeadsChanged: () => void }) {
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [busy, setBusy] = useState<"find" | "send" | null>(null);

  const load = useCallback(async () => {
    setStats(await api.get<EmailStats>(`/email/campaigns/${campaignId}/stats`).catch(() => null));
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);
  // Enquanto há e-mails na fila, atualiza o funil a cada 10 s.
  useEffect(() => {
    if (!stats?.queued) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [stats?.queued, load]);

  const findEmails = async () => {
    setBusy("find");
    try {
      const r = await api.post<{ checking: number }>(`/scraper/campaigns/${campaignId}/find-emails`, {});
      toast.success(r.checking ? `Procurando e-mail no site de ${r.checking} leads. Isso leva alguns minutos.` : "Nenhum lead sem e-mail com site para verificar.");
      // A busca roda em segundo plano: recarrega depois de um tempo.
      setTimeout(() => { load(); onLeadsChanged(); }, 60000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao buscar e-mails");
    } finally {
      setBusy(null);
    }
  };

  const sendAll = async () => {
    if (!stats) return;
    const n = Math.min(stats.eligible, stats.dailyLimit - stats.sentToday);
    if (!window.confirm(`Enviar e-mail para ${n} leads desta campanha? O envio é espaçado (1 a cada 4 s).`)) return;
    setBusy("send");
    try {
      const r = await api.post<{ queued: number; leftForLater: number }>(`/email/campaigns/${campaignId}/send`, {});
      toast.success(`${r.queued} e-mails na fila${r.leftForLater ? `; ${r.leftForLater} ficam para amanhã (limite diário)` : ""}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no envio");
    } finally {
      setBusy(null);
    }
  };

  if (!stats) return null;
  const funnel = [
    { label: "Enviados", value: stats.sent, rate: "" },
    { label: "Entregues", value: stats.delivered, rate: pct(stats.delivered, stats.sent) },
    { label: "Abertos*", value: stats.opened, rate: pct(stats.opened, stats.delivered) },
    { label: "Clicaram", value: stats.clicked, rate: pct(stats.clicked, stats.delivered) },
    { label: "Responderam", value: stats.replied, rate: pct(stats.replied, stats.delivered) },
  ];
  const remainingToday = Math.max(0, stats.dailyLimit - stats.sentToday);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Mail className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-base">E-mail</CardTitle>
          <span className="text-xs text-muted-foreground">
            {stats.leadsWithEmail} de {totalLeads} leads com e-mail
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={findEmails} disabled={!!busy}>
              {busy === "find" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Buscar e-mails nos sites
            </Button>
            {stats.configured && (
              <Button size="sm" variant="gradient" onClick={sendAll} disabled={!!busy || stats.eligible === 0 || remainingToday === 0}>
                {busy === "send" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Enviar para {Math.min(stats.eligible, remainingToday)} leads
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!stats.configured ? (
          <p className="text-sm text-muted-foreground">Conecte o Amazon SES em Integrações para enviar e acompanhar os e-mails.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {funnel.map((f) => (
                <div key={f.label} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="text-xl font-bold">{f.value}</p>
                  {f.rate && <p className="text-xs text-muted-foreground">{f.rate}</p>}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.queued > 0 && <>{stats.queued} na fila · </>}
              {stats.bounced > 0 && <>{stats.bounced} devolvidos · </>}
              {stats.complained > 0 && <span className="text-destructive">{stats.complained} marcados como spam · </span>}
              {stats.failed > 0 && <>{stats.failed} falharam · </>}
              Hoje: {stats.sentToday}/{stats.dailyLimit} enviados. *Abertura é estimativa: o Apple Mail abre sozinho e o Outlook bloqueia imagens.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
