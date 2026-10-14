"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageCircle, Mail, Send, Webhook, Plug, ArrowRight, Zap, Loader2, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

type IntegrationId = "whatsapp" | "ses" | "gmail" | "telegram" | "webhook" | "zapier" | "n8n";
type Configurable = "telegram" | "webhook" | "whatsapp" | "ses";

interface StoredIntegration {
  type: string;
  config: Record<string, string>;
}

const EVENTS = [
  { id: "campaign.completed", label: "Campanha concluída (envia os leads)" },
  { id: "campaign.failed", label: "Campanha falhou" },
  { id: "lead.status_changed", label: "Lead mudou de status no CRM" },
];

const integrations: Array<{
  id: IntegrationId;
  name: string;
  description: string;
  icon: typeof Mail;
  color: string;
  bg: string;
  category: string;
  // "builtin": já funciona sem configuração; senão, qual config salva ativa o card
  mode: "builtin" | Configurable;
}> = [
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "Envie a abordagem direto pelo Prospex com a API oficial do WhatsApp (Meta). Sem conexão, o botão do lead abre o WhatsApp com a mensagem pronta para você enviar.",
    icon: MessageCircle,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    category: "Mensagens",
    mode: "whatsapp",
  },
  {
    id: "ses",
    name: "Amazon SES",
    description: "Envie os e-mails de abordagem pelo Prospex, um por um ou em lote por campanha, e acompanhe entrega, abertura, clique e resposta de cada lead.",
    icon: Mail,
    color: "text-amber-600",
    bg: "bg-amber-500/10",
    category: "E-mail",
    mode: "ses",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Na tela de cada lead, o botão \"Abrir no Gmail\" cria o e-mail com destinatário, assunto e texto preenchidos.",
    icon: Mail,
    color: "text-red-500",
    bg: "bg-red-500/10",
    category: "E-mail",
    mode: "builtin",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Receba no Telegram um aviso quando uma campanha terminar ou um lead mudar de status no CRM.",
    icon: Send,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    category: "Notificações",
    mode: "telegram",
  },
  {
    id: "webhook",
    name: "Webhook",
    description: "Envia os leads e eventos em JSON para qualquer endereço HTTP: seu sistema, planilha ou automação.",
    icon: Webhook,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    category: "Automação",
    mode: "webhook",
  },
  {
    id: "zapier",
    name: "Zapier",
    description: "Leve os leads para mais de 6.000 apps (Google Sheets, HubSpot, Pipedrive, RD Station...) via Webhook.",
    icon: Zap,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    category: "Automação",
    mode: "webhook",
  },
  {
    id: "n8n",
    name: "n8n / Make",
    description: "Monte fluxos automáticos com os leads do Prospex usando o nó Webhook do n8n ou do Make.",
    icon: Plug,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    category: "Automação",
    mode: "webhook",
  },
];

const GUIDES: Record<IntegrationId, React.ReactNode> = {
  whatsapp: (
    <ol className="list-decimal pl-4 space-y-1">
      <li>Em <b>developers.facebook.com</b>, crie um app do tipo <b>Empresa</b> e adicione o produto <b>WhatsApp</b>.</li>
      <li>Em <b>WhatsApp → Configuração da API</b>, copie o <b>ID do número de telefone</b> e o <b>ID da conta do WhatsApp Business</b>.</li>
      <li>No <b>Meta Business → Usuários do sistema</b>, gere um <b>token permanente</b> com as permissões <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>.</li>
      <li>No <b>WhatsApp Manager → Modelos de mensagem</b>, crie um modelo (categoria Marketing, idioma Português), por exemplo: <i>Olá, {"{{1}}"}! {"{{2}}"}</i>, e aguarde a aprovação.</li>
    </ol>
  ),
  ses: (
    <ol className="list-decimal pl-4 space-y-1">
      <li>No <b>Amazon SES</b>, verifique o subdomínio de envio (ex.: <code>contato.netwish.com.br</code>) com DKIM e configure SPF/DMARC no DNS.</li>
      <li>Crie um <b>configuration set</b> com rastreamento de abertura e clique e um destino de eventos <b>SNS</b> apontando para <code>/api/email/sns</code>.</li>
      <li>Para as respostas virarem &quot;Respondeu&quot; no CRM: aponte o MX do domínio de respostas para o SES e crie uma regra de recebimento com ação SNS.</li>
      <li>Crie um usuário IAM só com <code>ses:SendEmail</code> e <code>ses:GetAccount</code> e cole as chaves abaixo.</li>
    </ol>
  ),
  gmail: null,
  telegram: (
    <ol className="list-decimal pl-4 space-y-1">
      <li>No Telegram, fale com <b>@BotFather</b>, envie <code>/newbot</code> e copie o <b>token</b>.</li>
      <li>Abra uma conversa com o seu bot novo e envie qualquer mensagem.</li>
      <li>Fale com <b>@userinfobot</b> para descobrir o seu <b>ID</b> (ou use o ID de um grupo onde o bot esteja).</li>
    </ol>
  ),
  webhook: (
    <p>Cole o endereço que vai receber os dados. Enviamos um <code>POST</code> em JSON com <code>event</code>, <code>timestamp</code> e <code>data</code>. Se informar um segredo, o cabeçalho <code>X-Prospex-Signature</code> traz o HMAC-SHA256 do corpo.</p>
  ),
  zapier: (
    <ol className="list-decimal pl-4 space-y-1">
      <li>No Zapier, crie um Zap com o gatilho <b>Webhooks by Zapier → Catch Hook</b>.</li>
      <li>Copie a URL que o Zapier gerar e cole abaixo.</li>
      <li>Clique em <b>Enviar teste</b> para o Zapier reconhecer o formato dos dados.</li>
    </ol>
  ),
  n8n: (
    <ol className="list-decimal pl-4 space-y-1">
      <li>No n8n, adicione o nó <b>Webhook</b> (método POST); no Make, o módulo <b>Custom webhook</b>.</li>
      <li>Copie a URL de produção e cole abaixo.</li>
      <li>Clique em <b>Enviar teste</b> para conferir o recebimento.</li>
    </ol>
  ),
};

const categories = [...new Set(integrations.map((i) => i.category))];

export function IntegrationsPage() {
  const [stored, setStored] = useState<StoredIntegration[]>([]);
  const [open, setOpen] = useState<IntegrationId | null>(null);

  const load = useCallback(async () => {
    try {
      setStored(await api.get<StoredIntegration[]>("/settings/integrations"));
    } catch {
      setStored([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isConnected = (mode: (typeof integrations)[number]["mode"]) => {
    if (mode === "builtin") return true;
    const cfg = stored.find((s) => s.type === mode)?.config;
    if (mode === "whatsapp") return !!(cfg?.accessToken && cfg?.phoneNumberId);
    if (mode === "ses") return !!cfg?.fromEmail;
    return mode === "webhook" ? !!cfg?.url : !!(cfg?.botToken && cfg?.chatId);
  };

  const current = integrations.find((i) => i.id === open);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrações</h1>
          <p className="text-muted-foreground mt-1">Conecte o Prospex às ferramentas e fluxos de trabalho que você já usa</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/settings">
            Configurar chaves de IA <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {categories.map((category) => (
        <div key={category}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{category}</h2>
          <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {integrations
              .filter((i) => i.category === category)
              .map((integration) => {
                const connected = isConnected(integration.mode);
                return (
                  <motion.div key={integration.id} variants={item}>
                    <Card className="relative overflow-hidden h-full flex flex-col">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${integration.bg} flex-shrink-0`}>
                              <integration.icon className={`w-5 h-5 ${integration.color}`} />
                            </div>
                            <CardTitle className="text-sm">{integration.name}</CardTitle>
                          </div>
                          {connected ? (
                            <Badge variant="success" className="text-[10px] flex-shrink-0">
                              {integration.mode === "builtin" ? "Ativo" : "Conectado"}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] flex-shrink-0">Não conectado</Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0 flex-1 flex flex-col gap-3">
                        <CardDescription className="text-xs leading-relaxed flex-1">{integration.description}</CardDescription>
                        {integration.mode === "builtin" ? (
                          <Button size="sm" variant="outline" asChild className="self-start">
                            <Link href="/leads">Ver leads</Link>
                          </Button>
                        ) : (
                          <Button size="sm" variant={connected ? "outline" : "gradient"} className="self-start" onClick={() => setOpen(integration.id)}>
                            {connected ? "Configurar" : "Conectar"}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
          </motion.div>
        </div>
      ))}

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-4 py-4 flex-wrap">
          <div className="p-2 bg-gradient-brand rounded-lg flex-shrink-0 shadow-glow">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-medium">API REST do Prospex</p>
            <p className="text-xs text-muted-foreground mt-0.5">Acesse leads e campanhas via código com uma chave de API.</p>
          </div>
          <Button size="sm" asChild variant="outline">
            <Link href="/settings">Chaves de API</Link>
          </Button>
        </CardContent>
      </Card>

      {current && current.mode !== "builtin" && (
        <IntegrationDialog
          key={current.id}
          integrationId={current.id}
          title={current.name}
          type={current.mode}
          initial={stored.find((s) => s.type === current.mode)?.config ?? {}}
          onClose={() => setOpen(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function IntegrationDialog({
  integrationId,
  title,
  type,
  initial,
  onClose,
  onSaved,
}: {
  integrationId: IntegrationId;
  title: string;
  type: Configurable;
  initial: Record<string, string>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [cfg, setCfg] = useState<Record<string, string>>(initial);
  const [events, setEvents] = useState<string[]>(
    initial.events ? initial.events.split(",") : EVENTS.map((e) => e.id),
  );
  const [templates, setTemplates] = useState<Array<{ name: string; language: string; body: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg((p) => ({ ...p, [k]: e.target.value }));

  // WhatsApp e SES não usam a lista de eventos: eles enviam mensagens, não recebem avisos.
  const hasEvents = type !== "whatsapp" && type !== "ses";
  const valid =
    type === "webhook" ? /^https?:\/\/.+/i.test(cfg.url ?? "")
    : type === "telegram" ? !!(cfg.botToken && cfg.chatId)
    : type === "ses" ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.fromEmail ?? "")
    : !!(cfg.accessToken && cfg.phoneNumberId && cfg.templateName);

  const buildConfig = (): Record<string, string> => {
    if (type === "webhook") return { url: cfg.url ?? "", secret: cfg.secret ?? "", events: events.join(",") };
    if (type === "telegram") return { botToken: cfg.botToken ?? "", chatId: cfg.chatId ?? "", events: events.join(",") };
    if (type === "ses") {
      return {
        accessKeyId: (cfg.accessKeyId ?? "").trim(),
        secretAccessKey: cfg.secretAccessKey ?? "",
        region: (cfg.region || "us-east-1").trim(),
        fromEmail: (cfg.fromEmail ?? "").trim(),
        fromName: (cfg.fromName ?? "").trim(),
        configurationSet: (cfg.configurationSet ?? "").trim(),
        replyDomain: (cfg.replyDomain ?? "").trim(),
        forwardRepliesTo: (cfg.forwardRepliesTo ?? "").trim(),
        dailyLimit: cfg.dailyLimit || "50",
      };
    }
    return {
      accessToken: cfg.accessToken ?? "",
      phoneNumberId: (cfg.phoneNumberId ?? "").trim(),
      wabaId: (cfg.wabaId ?? "").trim(),
      templateName: (cfg.templateName ?? "").trim(),
      templateLanguage: (cfg.templateLanguage || "pt_BR").trim(),
      templateParams: cfg.templateParams || "2",
    };
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/settings/integrations", { type, name: title, config: buildConfig() });
      await onSaved();
      toast.success("Integração salva");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!(await save())) return;
    setTesting(true);
    try {
      const r = await api.post<{ ok: boolean; status?: number; error?: string; phone?: string; name?: string; production?: boolean; sentLast24h?: number; max24h?: number }>(
        type === "ses" ? "/email/test" : `/integrations/${type}/test`,
        {},
      );
      if (r.ok && type === "ses") {
        if (r.production) toast.success(`SES conectado: ${r.sentLast24h} de ${r.max24h} envios usados nas últimas 24 h`);
        else toast.warning("SES conectado, mas em sandbox: só envia para endereços verificados");
      } else if (r.ok && type === "whatsapp") {
        toast.success(`Conectado ao número ${r.phone} (${r.name})`);
        if (cfg.wabaId) setTemplates(await api.get<typeof templates>("/integrations/whatsapp/templates").catch(() => []));
      } else if (r.ok) {
        toast.success(type === "telegram" ? "Mensagem de teste enviada ao Telegram" : `Teste entregue (HTTP ${r.status})`);
      } else {
        toast.error(`O destino recusou o teste: ${r.error ?? `HTTP ${r.status}`}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no teste");
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      const empty = Object.fromEntries(Object.keys(buildConfig()).map((k) => [k, ""]));
      await api.post("/settings/integrations", { type, name: title, config: empty });
      await onSaved();
      toast.success("Integração desconectada");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) => setEvents((p) => (p.includes(id) ? p.filter((e) => e !== id) : [...p, id]));
  const blocked = !valid || saving || testing || (hasEvents && events.length === 0);
  const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conectar {title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-xs leading-relaxed space-y-2 pt-1">{GUIDES[integrationId]}</div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {type === "webhook" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="wh-url">URL do webhook</Label>
                <Input id="wh-url" placeholder="https://hooks.zapier.com/hooks/catch/..." value={cfg.url ?? ""} onChange={set("url")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wh-secret">Segredo para assinatura (opcional)</Label>
                <Input id="wh-secret" type="password" placeholder="Deixe vazio se não usar" value={cfg.secret ?? ""} onChange={set("secret")} />
              </div>
            </>
          )}

          {type === "telegram" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tg-token">Token do bot</Label>
                <Input id="tg-token" type="password" placeholder="123456789:AA..." value={cfg.botToken ?? ""} onChange={set("botToken")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tg-chat">ID do chat</Label>
                <Input id="tg-chat" placeholder="Ex.: 123456789 ou -100... (grupo)" value={cfg.chatId ?? ""} onChange={set("chatId")} />
              </div>
            </>
          )}

          {type === "whatsapp" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="wa-token">Token de acesso permanente</Label>
                <Input id="wa-token" type="password" placeholder="EAAG..." value={cfg.accessToken ?? ""} onChange={set("accessToken")} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wa-phone">ID do número de telefone</Label>
                  <Input id="wa-phone" placeholder="123456789012345" value={cfg.phoneNumberId ?? ""} onChange={set("phoneNumberId")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-waba">ID da conta Business (opcional)</Label>
                  <Input id="wa-waba" placeholder="Para listar os modelos" value={cfg.wabaId ?? ""} onChange={set("wabaId")} />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wa-tpl">Nome do modelo aprovado</Label>
                  {templates.length > 0 ? (
                    <select
                      id="wa-tpl"
                      className={selectClass}
                      value={cfg.templateName ?? ""}
                      onChange={(e) => {
                        const t = templates.find((x) => x.name === e.target.value);
                        const vars = t ? (t.body.match(/\{\{\d+\}\}/g) ?? []).length : 2;
                        setCfg((p) => ({
                          ...p,
                          templateName: e.target.value,
                          templateLanguage: t?.language ?? p.templateLanguage,
                          templateParams: String(Math.min(vars, 2)),
                        }));
                      }}
                    >
                      <option value="">Escolha…</option>
                      {templates.map((t) => (
                        <option key={t.name + t.language} value={t.name}>{t.name} ({t.language})</option>
                      ))}
                    </select>
                  ) : (
                    <Input id="wa-tpl" placeholder="ex.: prospeccao_inicial" value={cfg.templateName ?? ""} onChange={set("templateName")} />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-lang">Idioma</Label>
                  <Input id="wa-lang" className="w-24" placeholder="pt_BR" value={cfg.templateLanguage ?? ""} onChange={set("templateLanguage")} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-params">Variáveis do modelo</Label>
                <select
                  id="wa-params"
                  className={selectClass}
                  value={cfg.templateParams || "2"}
                  onChange={(e) => setCfg((p) => ({ ...p, templateParams: e.target.value }))}
                >
                  <option value="2">{"{{1}}"} = nome da empresa · {"{{2}}"} = mensagem da IA</option>
                  <option value="1">{"{{1}}"} = nome da empresa</option>
                  <option value="0">Sem variáveis (texto fixo do modelo)</option>
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                A Meta cobra por mensagem de marketing (cerca de R$ 0,35 no Brasil). Envie só para empresas com boa chance de interesse.
              </p>
            </>
          )}

          {type === "ses" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ses-from">E-mail de envio</Label>
                  <Input id="ses-from" placeholder="vinicius@contato.netwish.com.br" value={cfg.fromEmail ?? ""} onChange={set("fromEmail")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ses-name">Nome do remetente</Label>
                  <Input id="ses-name" placeholder="Vinicius | Netwish" value={cfg.fromName ?? ""} onChange={set("fromName")} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ses-key">Access key ID (IAM)</Label>
                  <Input id="ses-key" placeholder="AKIA..." value={cfg.accessKeyId ?? ""} onChange={set("accessKeyId")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ses-secret">Secret access key</Label>
                  <Input id="ses-secret" type="password" value={cfg.secretAccessKey ?? ""} onChange={set("secretAccessKey")} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ses-region">Região</Label>
                  <Input id="ses-region" placeholder="us-east-1" value={cfg.region ?? ""} onChange={set("region")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ses-cs">Configuration set (rastreamento)</Label>
                  <Input id="ses-cs" placeholder="prospex" value={cfg.configurationSet ?? ""} onChange={set("configurationSet")} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ses-reply">Domínio de respostas (opcional)</Label>
                  <Input id="ses-reply" placeholder="resposta.netwish.com.br" value={cfg.replyDomain ?? ""} onChange={set("replyDomain")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ses-fwd">Encaminhar respostas para</Label>
                  <Input id="ses-fwd" placeholder="vinicius@netwish.com.br" value={cfg.forwardRepliesTo ?? ""} onChange={set("forwardRepliesTo")} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ses-limit">Limite de e-mails por dia</Label>
                <Input id="ses-limit" type="number" min={1} className="w-32" value={cfg.dailyLimit ?? "50"} onChange={set("dailyLimit")} />
              </div>
              <p className="text-xs text-muted-foreground">
                E-mail frio de domínio novo: comece com 20 a 50 por dia e aumente aos poucos. Reclamação de spam acima de 0,1% pode pausar a conta SES inteira.
              </p>
            </>
          )}

          {hasEvents && (
            <div className="space-y-2">
              <Label>Enviar quando</Label>
              {EVENTS.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={events.includes(e.id)} onChange={() => toggle(e.id)} />
                  {e.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          {(initial.url || initial.botToken || initial.accessToken || initial.fromEmail) && (
            <Button variant="ghost" className="text-destructive sm:mr-auto" onClick={disconnect} disabled={saving || testing}>
              Desconectar
            </Button>
          )}
          <Button variant="outline" onClick={test} disabled={blocked}>
            {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            {type === "whatsapp" || type === "ses" ? "Testar conexão" : "Enviar teste"}
          </Button>
          <Button variant="gradient" onClick={async () => { if (await save()) onClose(); }} disabled={blocked}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
