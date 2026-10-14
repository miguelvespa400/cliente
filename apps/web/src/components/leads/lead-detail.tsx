"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Phone, Globe, MapPin, Star, Mail, MessageCircle, Loader2, Copy, Instagram, Send, Pencil } from "lucide-react";
import { gmailComposeUrl, whatsappUrl } from "@/lib/outreach";
import { useLead } from "@/hooks/use-leads";
import { WhatsAppSendDialog } from "@/components/leads/whatsapp-send-dialog";
import { LeadEmailPanel } from "@/components/leads/lead-email-panel";
import { LeadContentDialog } from "@/components/leads/lead-content-dialog";
import { api } from "@/lib/api";
import { ACTIVITY_TYPE_LABELS, INDUSTRY_LABELS, labelFor } from "@/lib/labels";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export function LeadDetail({ id }: { id: string }) {
  const { lead, loading, refresh } = useLead(id);
  const [crmStatus, setCrmStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // WhatsApp Cloud API conectado em Integrações? Se não, o botão abre o wa.me com a mensagem pronta.
  const [waConfig, setWaConfig] = useState<Record<string, string> | null>(null);
  const [waOpen, setWaOpen] = useState(false);
  const [sesConnected, setSesConnected] = useState(false);
  const [editContent, setEditContent] = useState(false);

  useEffect(() => {
    api
      .get<Array<{ type: string; config: Record<string, string> }>>("/settings/integrations")
      .then((list) => {
        const cfg = list.find((i) => i.type === "whatsapp")?.config;
        setWaConfig(cfg?.accessToken && cfg?.phoneNumberId ? cfg : null);
        setSesConnected(!!list.find((i) => i.type === "ses")?.config?.fromEmail);
      })
      .catch(() => setWaConfig(null));
  }, []);

  const handleCrmUpdate = async () => {
    if (!crmStatus || !lead) return;
    setSaving(true);
    try {
      await api.patch(`/leads/${id}/crm`, { crmStatus });
      await refresh();
    } catch (e) {
      console.error("CRM update failed:", e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
          <Skeleton className="h-8 w-12" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <Skeleton className="h-4 w-28" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-3/4" />
                ))}
              </CardContent>
            </Card>
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }
  if (!lead) {
    return <div className="text-center py-20 text-muted-foreground">Lead não encontrado</div>;
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-6 max-w-4xl"
    >
      <motion.div variants={item} className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/leads"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">{lead.name}</h1>
            {lead.priority === "HIGH" && <Badge variant="success">Alta prioridade</Badge>}
            {lead.hasWebsite && <Badge variant="info">Tem site</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{[lead.category || labelFor(INDUSTRY_LABELS, lead.industry), lead.address].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-2xl font-bold text-primary">{lead.score}</div>
          <div className="text-xs text-muted-foreground">Pontuação IA</div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div variants={item} className="lg:col-span-2 space-y-4">
          {/* Contact Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Informações de contato</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { icon: Phone, label: "Telefone", value: lead.phone, href: whatsappUrl(lead.phone, "") ?? undefined },
                { icon: Mail, label: "E-mail", value: lead.email ?? undefined, href: lead.email ? `mailto:${lead.email}` : undefined },
                { icon: Globe, label: "Site", value: lead.website, href: lead.website ? (/^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`) : undefined },
                { icon: MapPin, label: "Endereço", value: lead.address, href: lead.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}` : undefined },
                { icon: Star, label: "Avaliação", value: lead.rating ? `${lead.rating} estrelas no Google Maps` : undefined, href: undefined },
              ]
                .filter((i) => i.value)
                .map((item) => (
                  <div key={item.label} className="flex items-center gap-3">
                    <item.icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    {item.href ? (
                      <a
                        href={item.href}
                        target={item.href.startsWith("http") ? "_blank" : undefined}
                        rel="noreferrer"
                        className="text-sm flex-1 break-all text-primary hover:underline"
                      >
                        {item.value}
                      </a>
                    ) : (
                      <span className="text-sm flex-1 break-all">{item.value}</span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-40 hover:opacity-100 flex-shrink-0"
                      onClick={() => navigator.clipboard.writeText(item.value!)}
                      aria-label={`Copiar ${item.label.toLowerCase()}`}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
            </CardContent>
          </Card>

          {/* AI Marketing Content */}
          {lead.marketingContent && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">Abordagem gerada por IA</CardTitle>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditContent(true)}>
                    <Pencil className="w-3 h-3 mr-1" />Editar textos
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {lead.marketingContent.email && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Mail className="w-4 h-4 text-info" />
                      <span className="text-sm font-medium">E-mail</span>
                      <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs opacity-60 hover:opacity-100" onClick={() => navigator.clipboard.writeText(lead.marketingContent!.email!.body)}>
                        Copiar
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs" asChild>
                        <a
                          href={gmailComposeUrl(lead.email, lead.marketingContent.email.subject, lead.marketingContent.email.body)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Send className="w-3 h-3 mr-1" />Abrir no Gmail
                        </a>
                      </Button>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3 text-xs leading-relaxed">
                      <p className="font-medium text-muted-foreground mb-1.5">Assunto: {lead.marketingContent.email.subject}</p>
                      <p className="whitespace-pre-wrap">{lead.marketingContent.email.body}</p>
                    </div>
                    {sesConnected && (
                      <div className="mt-3">
                        <LeadEmailPanel leadId={id} hasEmail={!!lead.email} onSent={refresh} />
                      </div>
                    )}
                  </div>
                )}
                {lead.marketingContent.whatsapp && (
                  <>
                    <Separator />
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <MessageCircle className="w-4 h-4 text-success" />
                        <span className="text-sm font-medium">WhatsApp</span>
                        <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs opacity-60 hover:opacity-100" onClick={() => navigator.clipboard.writeText(lead.marketingContent!.whatsapp!)}>
                          Copiar
                        </Button>
                        {waConfig && lead.phone ? (
                          <Button size="sm" className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setWaOpen(true)}>
                            <MessageCircle className="w-3 h-3 mr-1" />Enviar pelo WhatsApp
                          </Button>
                        ) : whatsappUrl(lead.phone, lead.marketingContent.whatsapp) && (
                          <Button size="sm" className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" asChild>
                            <a href={whatsappUrl(lead.phone, lead.marketingContent.whatsapp)!} target="_blank" rel="noreferrer">
                              <MessageCircle className="w-3 h-3 mr-1" />Enviar pelo WhatsApp
                            </a>
                          </Button>
                        )}
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap">
                        {lead.marketingContent.whatsapp}
                      </div>
                    </div>
                  </>
                )}
                {lead.marketingContent.instagram && (
                  <>
                    <Separator />
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Instagram className="w-4 h-4 text-pink-500" />
                        <span className="text-sm font-medium">Direct do Instagram</span>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-3 text-xs leading-relaxed">
                        {lead.marketingContent.instagram}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </motion.div>

        {/* CRM Panel */}
        <motion.div variants={item} className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Status no CRM</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                defaultValue={lead.crmStatus}
                onValueChange={(v) => setCrmStatus(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">🔵 Novo</SelectItem>
                  <SelectItem value="contacted">📤 Contatado</SelectItem>
                  <SelectItem value="replied">💬 Respondeu</SelectItem>
                  <SelectItem value="meeting">📅 Reunião</SelectItem>
                  <SelectItem value="proposal">📄 Proposta</SelectItem>
                  <SelectItem value="won">✅ Ganho</SelectItem>
                  <SelectItem value="lost">❌ Perdido</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="gradient"
                className="w-full text-sm h-9"
                onClick={handleCrmUpdate}
                disabled={saving || !crmStatus}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar status"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Histórico de atividades</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(lead.activities || []).map((a) => (
                  <div key={a.id} className="text-xs border-l-2 border-primary/30 pl-3">
                    <p className="font-medium capitalize text-muted-foreground">{labelFor(ACTIVITY_TYPE_LABELS, a.type)}</p>
                    <p className="mt-0.5">{a.note}</p>
                  </div>
                ))}
                {(!lead.activities || lead.activities.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhuma atividade ainda</p>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {editContent && lead.marketingContent && (
        <LeadContentDialog leadId={id} content={lead.marketingContent} onClose={() => setEditContent(false)} onSaved={refresh} />
      )}

      {waOpen && lead.phone && (
        <WhatsAppSendDialog
          leadId={lead.id}
          leadName={lead.name}
          phone={lead.phone}
          message={lead.marketingContent?.whatsapp ?? ""}
          templateName={waConfig?.templateName}
          onClose={() => setWaOpen(false)}
          onSent={refresh}
        />
      )}
    </motion.div>
  );
}
