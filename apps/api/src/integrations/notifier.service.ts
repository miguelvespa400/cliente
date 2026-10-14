import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "crypto";
import { SettingsService } from "../settings/settings.service";

// Eventos enviados às integrações de saída (Webhook — e por ele Zapier/n8n/Make — e Telegram).
export type ProspexEvent = "campaign.completed" | "campaign.failed" | "lead.status_changed";

export const PROSPEX_EVENTS: ProspexEvent[] = ["campaign.completed", "campaign.failed", "lead.status_changed"];

const CRM_STATUS_PT: Record<string, string> = {
  new: "Novo", contacted: "Contatado", replied: "Respondeu", meeting: "Reunião",
  proposal: "Proposta", won: "Ganho", lost: "Perdido",
};

const TIMEOUT_MS = 10_000;

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  constructor(
    private settings: SettingsService,
    private config: ConfigService,
  ) {}

  /** Dispara o evento para todas as integrações ativas do workspace. Nunca lança erro. */
  async emit(workspaceId: string, event: ProspexEvent, data: Record<string, unknown>): Promise<void> {
    const [webhook, telegram] = await Promise.all([
      this.settings.getIntegrationConfig(workspaceId, "webhook").catch(() => null),
      this.settings.getIntegrationConfig(workspaceId, "telegram").catch(() => null),
    ]);
    const jobs: Promise<DeliveryResult>[] = [];
    if (webhook?.url && wants(webhook.events, event)) jobs.push(this.sendWebhook(webhook, event, workspaceId, data));
    if (telegram?.botToken && telegram.chatId && wants(telegram.events, event)) {
      jobs.push(this.sendTelegram(telegram, this.formatTelegram(event, data)));
    }
    const results = await Promise.all(jobs);
    for (const r of results) if (!r.ok) this.logger.warn(`Falha ao entregar ${event}: ${r.error ?? r.status}`);
  }

  async sendWebhook(
    cfg: Record<string, string>,
    event: string,
    workspaceId: string,
    data: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), workspaceId, data });
    const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "WishLead-Webhook/1.0" };
    // Assinatura opcional para o receptor validar a origem: HMAC-SHA256 do corpo com o segredo.
    if (cfg.secret) headers["X-Prospex-Signature"] = `sha256=${createHmac("sha256", cfg.secret).update(body).digest("hex")}`;
    return deliver(cfg.url, { method: "POST", headers, body });
  }

  async sendTelegram(cfg: Record<string, string>, text: string): Promise<DeliveryResult> {
    return deliver(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  }

  private appUrl(path: string) {
    const base = (this.config.get<string>("NEXT_PUBLIC_APP_URL") || "http://localhost:3000").replace(/\/$/, "");
    return `${base}${path}`;
  }

  formatTelegram(event: ProspexEvent | "test", data: Record<string, unknown>): string {
    const d = data as Record<string, any>;
    if (event === "campaign.completed") {
      return [
        `✅ <b>Campanha concluída:</b> ${esc(d.campaign?.name)}`,
        `${d.stats?.totalLeads ?? 0} leads · ${d.stats?.priorityLeads ?? 0} de alta prioridade · nota média ${d.stats?.averageScore ?? 0}`,
        `<a href="${this.appUrl(`/campaigns/detalhe?id=${d.campaign?.id}`)}">Abrir no WishLead</a>`,
      ].join("\n");
    }
    if (event === "campaign.failed") {
      return `⚠️ <b>Campanha falhou:</b> ${esc(d.campaign?.name)}\n${esc(d.error)}`;
    }
    if (event === "lead.status_changed") {
      return [
        `🔄 <b>${esc(d.lead?.name)}</b>: ${CRM_STATUS_PT[d.from] ?? d.from} → <b>${CRM_STATUS_PT[d.to] ?? d.to}</b>`,
        d.lead?.phone ? `📞 ${esc(d.lead.phone)}` : "",
        `<a href="${this.appUrl(`/leads/detalhe?id=${d.lead?.id}`)}">Abrir no WishLead</a>`,
      ].filter(Boolean).join("\n");
    }
    return "🔔 <b>WishLead conectado!</b> Você vai receber aqui os avisos de campanhas e do CRM.";
  }
}

// events vazio = todos os eventos; senão, lista separada por vírgula.
function wants(events: string | undefined, event: string) {
  if (!events) return true;
  return events.split(",").map((e) => e.trim()).includes(event);
}

function esc(v: unknown) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function deliver(url: string, init: RequestInit): Promise<DeliveryResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: `HTTP ${res.status} ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
