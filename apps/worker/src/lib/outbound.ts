// Integrações de saída — mesmas regras de apps/api/src/integrations (notifier + whatsapp).
import { hmacSha256Hex } from "./crypto";

export type ProspexEvent = "campaign.completed" | "campaign.failed" | "lead.status_changed" | "tasks.daily_digest";

const TASK_PT: Record<string, string> = {
  call: "Ligar", whatsapp: "WhatsApp", email: "E-mail", meeting: "Reunião", visit: "Visita", other: "Tarefa",
};

const CRM_PT: Record<string, string> = {
  new: "Novo", contacted: "Contatado", replied: "Respondeu", meeting: "Reunião",
  proposal: "Proposta", won: "Ganho", lost: "Perdido",
};

export interface Delivery {
  ok: boolean;
  status?: number;
  error?: string;
}

async function deliver(url: string, init: RequestInit): Promise<Delivery> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const wants = (events: string | undefined, event: string) =>
  !events || events.split(",").map((e) => e.trim()).includes(event);

export async function sendWebhook(cfg: Record<string, string>, event: string, workspaceId: string, data: unknown) {
  const body = JSON.stringify({ event, timestamp: new Date().toISOString(), workspaceId, data });
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "Prospex-Webhook/1.0" };
  if (cfg.secret) headers["X-Prospex-Signature"] = `sha256=${await hmacSha256Hex(cfg.secret, body)}`;
  return deliver(cfg.url, { method: "POST", headers, body });
}

export async function sendTelegram(cfg: Record<string, string>, text: string) {
  return deliver(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function telegramText(event: ProspexEvent | "test", d: Record<string, any>, appUrl: string): string {
  if (event === "campaign.completed") {
    return `✅ <b>Campanha concluída:</b> ${esc(d.campaign?.name)}\n${d.stats?.totalLeads ?? 0} leads · ${d.stats?.priorityLeads ?? 0} de alta prioridade · nota média ${d.stats?.averageScore ?? 0}\n<a href="${appUrl}/campaigns/detalhe/?id=${d.campaign?.id}">Abrir no Prospex</a>`;
  }
  if (event === "campaign.failed") return `⚠️ <b>Campanha falhou:</b> ${esc(d.campaign?.name)}\n${esc(d.error)}`;
  if (event === "lead.status_changed") {
    return [
      `🔄 <b>${esc(d.lead?.name)}</b>: ${CRM_PT[d.from] ?? d.from} → <b>${CRM_PT[d.to] ?? d.to}</b>`,
      d.lead?.phone ? `📞 ${esc(d.lead.phone)}` : "",
      `<a href="${appUrl}/leads/detalhe/?id=${d.lead?.id}">Abrir no Prospex</a>`,
    ].filter(Boolean).join("\n");
  }
  if (event === "tasks.daily_digest") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line = (t: Record<string, any>) => {
      const hour = new Date(t.scheduledAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      return `• ${hour} <b>${TASK_PT[t.type] ?? "Tarefa"}</b> — ${esc(t.lead?.name)}: ${esc(t.note)}${t.lead?.owner ? ` (${esc(t.lead.owner)})` : ""}`;
    };
    const overdue = (d.overdue ?? []) as Array<Record<string, unknown>>;
    const today = (d.today ?? []) as Array<Record<string, unknown>>;
    const MAX = 15;
    return [
      `⏰ <b>Tarefas do dia ${esc(d.date)}</b>`,
      `${today.length} para hoje${overdue.length ? ` · ⚠️ ${overdue.length} atrasada(s)` : ""}`,
      ...(overdue.length ? ["\n<b>Atrasadas</b>", ...overdue.slice(0, MAX).map(line)] : []),
      ...(today.length ? ["\n<b>Hoje</b>", ...today.slice(0, MAX).map(line)] : []),
      overdue.length + today.length > MAX * 2 ? "…" : "",
      appUrl ? `\n<a href="${appUrl}/tasks/">Abrir tarefas no Prospex</a>` : "",
    ].filter((l) => l !== "").join("\n");
  }
  return "🔔 <b>Prospex conectado!</b> Você vai receber aqui os avisos de campanhas e do CRM.";
}

// ── WhatsApp Cloud API ─────────────────────────────────────────────────────
const GRAPH = "https://graph.facebook.com/v21.0";

const META_ERRORS: Record<number, string> = {
  190: "Token de acesso inválido ou expirado. Gere um token permanente (usuário do sistema) no Meta Business.",
  100: "Parâmetro inválido: confira o ID do número de telefone e o nome/idioma do modelo.",
  131030: "Número fora da lista de teste: no modo de desenvolvimento a Meta só envia para até 5 números cadastrados.",
  131026: "Mensagem não entregue: o número não usa WhatsApp ou não pode receber mensagens.",
  131047: "Passaram mais de 24 h sem resposta da empresa: use o envio por modelo aprovado.",
  132000: "A quantidade de variáveis não bate com o modelo aprovado.",
  132001: "Modelo não encontrado: confira o nome e o idioma (ex.: pt_BR) no WhatsApp Manager.",
  133010: "Este número de telefone ainda não foi registrado na Cloud API.",
  368: "A Meta bloqueou temporariamente este número por violação de política.",
  80007: "Limite de envios atingido. Aguarde e tente novamente.",
};

export class UserError extends Error {}

export async function graph<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new UserError(`Não foi possível falar com o WhatsApp: ${err instanceof Error ? err.message : err}`);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string; error_data?: { details?: string } } } & T;
  if (!res.ok || body.error) {
    const code = body.error?.code ?? res.status;
    throw new UserError(`WhatsApp: ${META_ERRORS[code] ?? body.error?.error_data?.details ?? body.error?.message ?? `HTTP ${res.status}`}`);
  }
  return body;
}

export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 13 ? digits : null;
}

export async function sendWhatsApp(
  cfg: Record<string, string>,
  to: string,
  opts: { mode: "template" | "text"; businessName: string; message: string },
) {
  const number = toWhatsAppNumber(to);
  if (!number) throw new UserError("Telefone do lead inválido para WhatsApp.");
  let payload: Record<string, unknown>;
  if (opts.mode === "text") {
    payload = { type: "text", text: { preview_url: false, body: opts.message.slice(0, 4096) } };
  } else {
    if (!cfg.templateName) throw new UserError("Informe o nome do modelo aprovado em Integrações → WhatsApp.");
    const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ").replace(/\s{4,}/g, "   ").trim().slice(0, 1000);
    const params = [opts.businessName, opts.message].slice(0, Number(cfg.templateParams ?? "2")).map((t) => ({ type: "text", text: oneLine(t) }));
    payload = {
      type: "template",
      template: {
        name: cfg.templateName,
        language: { code: cfg.templateLanguage || "pt_BR" },
        ...(params.length && { components: [{ type: "body", parameters: params }] }),
      },
    };
  }
  const res = await graph<{ messages: Array<{ id: string }> }>(cfg.accessToken, `/${cfg.phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: number, ...payload }),
  });
  return { messageId: res.messages?.[0]?.id ?? "", to: number, mode: opts.mode };
}
