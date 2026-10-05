import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";

// WhatsApp Cloud API (oficial da Meta). Config da integração "whatsapp":
//   accessToken (secreto), phoneNumberId, wabaId (opcional, para listar modelos),
//   templateName, templateLanguage (ex.: pt_BR), templateParams ("0" | "1" | "2").
// Regra da Meta: o 1º contato (ou após 24 h sem resposta da empresa) só pode ser um MODELO
// aprovado; texto livre só dentro da janela de 24 h aberta por uma mensagem recebida.
const GRAPH = "https://graph.facebook.com/v21.0";

// Erros mais comuns da Graph API traduzidos para quem vai usar o painel.
const META_ERRORS: Record<number, string> = {
  190: "Token de acesso inválido ou expirado. Gere um token permanente (usuário do sistema) no Meta Business.",
  100: "Parâmetro inválido: confira o ID do número de telefone e o nome/idioma do modelo.",
  131030: "Número fora da lista de teste: no modo de desenvolvimento a Meta só envia para até 5 números cadastrados.",
  131026: "Mensagem não entregue: o número não usa WhatsApp ou não pode receber mensagens.",
  131047: "Passaram mais de 24 h sem resposta da empresa: use o envio por modelo aprovado.",
  131051: "Tipo de mensagem não suportado.",
  132000: "A quantidade de variáveis não bate com o modelo aprovado.",
  132001: "Modelo não encontrado: confira o nome e o idioma (ex.: pt_BR) no WhatsApp Manager.",
  133010: "Este número de telefone ainda não foi registrado na Cloud API.",
  368: "A Meta bloqueou temporariamente este número por violação de política.",
  80007: "Limite de envios atingido. Aguarde e tente novamente.",
};

export interface WhatsAppSendResult {
  messageId: string;
  to: string;
  mode: "template" | "text";
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private settings: SettingsService) {}

  async getConfig(workspaceId: string) {
    const cfg = await this.settings.getIntegrationConfig(workspaceId, "whatsapp");
    if (!cfg?.accessToken || !cfg.phoneNumberId) {
      throw new BadRequestException("Conecte o WhatsApp em Integrações antes de enviar.");
    }
    return cfg;
  }

  /** Valida token + ID do número e devolve o número/nome verificado (botão "Testar conexão"). */
  async verify(workspaceId: string) {
    const cfg = await this.getConfig(workspaceId);
    const info = await this.graph<{ display_phone_number: string; verified_name: string; quality_rating?: string }>(
      cfg.accessToken,
      `/${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    );
    return { ok: true, phone: info.display_phone_number, name: info.verified_name, quality: info.quality_rating ?? null };
  }

  /** Modelos aprovados da conta (precisa do wabaId). */
  async listTemplates(workspaceId: string) {
    const cfg = await this.getConfig(workspaceId);
    if (!cfg.wabaId) return [];
    const res = await this.graph<{ data: Array<{ name: string; status: string; language: string; components: Array<{ type: string; text?: string }> }> }>(
      cfg.accessToken,
      `/${cfg.wabaId}/message_templates?fields=name,status,language,components&limit=100`,
    );
    return res.data
      .filter((t) => t.status === "APPROVED")
      .map((t) => ({ name: t.name, language: t.language, body: t.components.find((c) => c.type === "BODY")?.text ?? "" }));
  }

  async send(
    workspaceId: string,
    to: string,
    opts: { mode: "template" | "text"; businessName: string; message: string },
  ): Promise<WhatsAppSendResult> {
    const cfg = await this.getConfig(workspaceId);
    const number = toWhatsAppNumber(to);
    if (!number) throw new BadRequestException("Telefone do lead inválido para WhatsApp.");

    let payload: Record<string, unknown>;
    if (opts.mode === "text") {
      payload = { type: "text", text: { preview_url: false, body: opts.message.slice(0, 4096) } };
    } else {
      if (!cfg.templateName) throw new BadRequestException("Informe o nome do modelo aprovado em Integrações → WhatsApp.");
      // Variáveis de modelo não aceitam quebra de linha nem 4+ espaços seguidos (regra da Meta).
      const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ").replace(/\s{4,}/g, "   ").trim().slice(0, 1000);
      const count = Number(cfg.templateParams ?? "2");
      const params = [opts.businessName, opts.message].slice(0, count).map((t) => ({ type: "text", text: oneLine(t) }));
      payload = {
        type: "template",
        template: {
          name: cfg.templateName,
          language: { code: cfg.templateLanguage || "pt_BR" },
          ...(params.length && { components: [{ type: "body", parameters: params }] }),
        },
      };
    }

    const res = await this.graph<{ messages: Array<{ id: string }> }>(cfg.accessToken, `/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: number, ...payload }),
    });
    return { messageId: res.messages?.[0]?.id ?? "", to: number, mode: opts.mode };
  }

  private async graph<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${GRAPH}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new BadRequestException(`Não foi possível falar com o WhatsApp: ${err instanceof Error ? err.message : err}`);
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string; error_data?: { details?: string } } } & T;
    if (!res.ok || body.error) {
      const code = body.error?.code ?? res.status;
      const msg = META_ERRORS[code] ?? body.error?.error_data?.details ?? body.error?.message ?? `HTTP ${res.status}`;
      this.logger.warn(`WhatsApp API ${path} → ${code}: ${body.error?.message}`);
      throw new BadRequestException(`WhatsApp: ${msg}`);
    }
    return body;
  }
}

/** Normaliza telefone brasileiro para o formato da Cloud API (55 + DDD + número, só dígitos). */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 13 ? digits : null;
}
