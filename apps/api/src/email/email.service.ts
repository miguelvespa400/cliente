import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SESv2Client, SendEmailCommand, GetAccountCommand } from "@aws-sdk/client-sesv2";
import { simpleParser } from "mailparser";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { NotifierService } from "../integrations/notifier.service";
import { renderEmail, unsubscribeToken } from "./email-render";

// Integração "ses" (Configurações → Integrações). Campos:
//   accessKeyId, secretAccessKey (secreto), region, fromEmail, fromName,
//   configurationSet (rastreamento de abertura/clique), replyDomain (respostas → CRM),
//   forwardRepliesTo (cópia das respostas para uma caixa humana), dailyLimit.
export interface SesConfig {
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  fromEmail?: string;
  fromName?: string;
  configurationSet?: string;
  replyDomain?: string;
  forwardRepliesTo?: string;
  dailyLimit?: string;
}

const DEFAULT_DAILY_LIMIT = 50;
// Prefixo do Reply-To: r+<id da mensagem>@<replyDomain> liga a resposta ao e-mail enviado.
const REPLY_RE = /^r\+([a-z0-9]+)@/i;

interface SesEvent {
  eventType?: string;
  notificationType?: string;
  mail: { messageId: string; destination?: string[]; tags?: Record<string, string[]>; commonHeaders?: { from?: string[]; subject?: string } };
  bounce?: { bounceType: string; bounceSubType?: string; bouncedRecipients?: { emailAddress: string; diagnosticCode?: string }[] };
  complaint?: { complainedRecipients?: { emailAddress: string }[] };
  open?: { timestamp: string; userAgent?: string };
  click?: { timestamp: string; link: string; userAgent?: string };
  delivery?: { timestamp: string };
  reject?: { reason: string };
  failure?: { errorMessage: string };
  receipt?: { recipients?: string[]; action?: { encoding?: string } };
  content?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private config: ConfigService,
    private notifier: NotifierService,
  ) {}

  // ─── Configuração ──────────────────────────────────────────────────────────

  async getConfig(workspaceId: string): Promise<SesConfig & { fromEmail: string }> {
    const cfg = (await this.settings.getIntegrationConfig(workspaceId, "ses")) as SesConfig | null;
    if (!cfg?.fromEmail) throw new BadRequestException("Conecte o Amazon SES em Integrações antes de enviar e-mails.");
    return cfg as SesConfig & { fromEmail: string };
  }

  private client(cfg: SesConfig): SESv2Client {
    // Sempre as chaves do próprio workspace: nunca cair na cadeia padrão da AWS do servidor,
    // senão qualquer workspace enviaria pela conta/identidades da plataforma.
    if (!cfg.accessKeyId || !cfg.secretAccessKey) {
      throw new BadRequestException("Informe as chaves IAM do SES em Integrações.");
    }
    return new SESv2Client({
      region: cfg.region || "us-east-1",
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  /** Botão "Testar conexão": confere credenciais e se a conta está fora do sandbox. */
  async verify(workspaceId: string) {
    const cfg = await this.getConfig(workspaceId);
    try {
      const account = await this.client(cfg).send(new GetAccountCommand({}));
      return {
        ok: true,
        production: account.ProductionAccessEnabled ?? false,
        sendingEnabled: account.SendingEnabled ?? false,
        max24h: account.SendQuota?.Max24HourSend ?? null,
        sentLast24h: account.SendQuota?.SentLast24Hours ?? null,
      };
    } catch (e) {
      throw new BadRequestException(`Falha ao conectar no SES: ${e instanceof Error ? e.message : e}`);
    }
  }

  private dailyLimit(cfg: SesConfig): number {
    const n = Number(cfg.dailyLimit);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
  }

  async sentLast24h(workspaceId: string): Promise<number> {
    return this.prisma.emailMessage.count({
      where: { workspaceId, sentAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    });
  }

  private get publicApiUrl(): string {
    return this.config.get<string>("API_PUBLIC_URL", "http://localhost:3001").replace(/\/+$/, "");
  }

  // ─── Envio ─────────────────────────────────────────────────────────────────

  /** Cria a mensagem (status queued) a partir do texto da IA, ou do texto editado. */
  async prepare(workspaceId: string, leadId: string, override?: { subject?: string; body?: string }) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, workspaceId } });
    if (!lead) throw new NotFoundException("Lead não encontrado");
    const to = (lead.email ?? "").trim().toLowerCase();
    if (!to) throw new BadRequestException("Este lead não tem e-mail.");

    const suppressed = await this.prisma.emailSuppression.findUnique({ where: { workspaceId_email: { workspaceId, email: to } } });
    if (suppressed) throw new BadRequestException(`Este e-mail não recebe mais mensagens (${suppressed.reason}).`);

    // Prioridade: texto editado no envio > texto padrão da campanha > texto gerado para o lead.
    const content = (lead.marketingContent ?? {}) as { email?: { subject?: string; body?: string } };
    const campaign = await this.prisma.campaign.findUnique({ where: { id: lead.campaignId }, select: { emailTemplate: true } });
    const template = (campaign?.emailTemplate ?? null) as { subject?: string; body?: string } | null;
    const fill = (text: string) => text.replace(/\{\{\s*empresa\s*\}\}/gi, lead.name);
    const subject = fill(override?.subject?.trim() || template?.subject || content.email?.subject || "");
    const body = fill(override?.body?.trim() || template?.body || content.email?.body || "");
    if (!subject || !body) throw new BadRequestException("Defina o texto do e-mail da campanha ou gere o conteúdo do lead.");

    const cfg = await this.getConfig(workspaceId);
    return this.prisma.emailMessage.create({
      data: { workspaceId, leadId, campaignId: lead.campaignId, toEmail: to, fromEmail: cfg.fromEmail, subject, bodyText: body },
    });
  }

  /** Envia uma mensagem já preparada. Chamado direto (envio unitário) ou pela fila (lote). */
  async deliver(messageId: string) {
    const msg = await this.prisma.emailMessage.findUnique({ where: { id: messageId }, include: { lead: true } });
    if (!msg || msg.status !== "queued") return msg;
    const { workspaceId } = msg;

    const fail = async (error: string) => {
      await this.prisma.emailMessage.update({ where: { id: msg.id }, data: { status: "failed", error } });
      throw new BadRequestException(error);
    };

    const cfg = await this.getConfig(workspaceId);
    const limit = this.dailyLimit(cfg);
    if ((await this.sentLast24h(workspaceId)) >= limit) {
      return fail(`Limite diário de ${limit} e-mails atingido. Tente amanhã ou aumente o limite em Integrações.`);
    }
    // Pode ter sido descadastrado depois de entrar na fila.
    const suppressed = await this.prisma.emailSuppression.findUnique({
      where: { workspaceId_email: { workspaceId, email: msg.toEmail } },
    });
    if (suppressed) return fail(`Destinatário descadastrado (${suppressed.reason}).`);

    const secret = this.config.get<string>("JWT_SECRET")!;
    const unsubscribeUrl = `${this.publicApiUrl}/api/email/unsubscribe?t=${unsubscribeToken(msg.id, secret)}`;
    const { html, text } = renderEmail(msg.bodyText, unsubscribeUrl);
    const from = cfg.fromName ? `"${cfg.fromName.replace(/"/g, "")}" <${cfg.fromEmail}>` : cfg.fromEmail;

    try {
      const res = await this.client(cfg).send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [msg.toEmail] },
          ReplyToAddresses: cfg.replyDomain ? [`r+${msg.id}@${cfg.replyDomain}`] : undefined,
          ConfigurationSetName: cfg.configurationSet || undefined,
          EmailTags: [{ Name: "prospex_message", Value: msg.id }],
          Content: {
            Simple: {
              Subject: { Data: msg.subject, Charset: "UTF-8" },
              Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: text, Charset: "UTF-8" } },
              // Descadastro com 1 clique (RFC 8058) — Gmail e Yahoo exigem para remetentes em volume.
              Headers: [
                { Name: "List-Unsubscribe", Value: `<${unsubscribeUrl}>` },
                { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
              ],
            },
          },
        }),
      );
      const sentAt = new Date();
      const updated = await this.prisma.emailMessage.update({
        where: { id: msg.id },
        data: { status: "sent", sesMessageId: res.MessageId, sentAt },
      });
      await this.markContacted(msg.lead, msg.id, msg.subject);
      return updated;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      return fail(`SES recusou o envio: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async markContacted(lead: { id: string; crmStatus: string; workspaceId: string; name: string; email: string | null; phone: string | null; website: string | null; score: number; priority: string }, messageId: string, subject: string) {
    const wasNew = lead.crmStatus === "new";
    await this.prisma.$transaction([
      this.prisma.leadActivity.create({
        data: { leadId: lead.id, type: "email_sent", note: `E-mail enviado: ${subject}`, metadata: { messageId } },
      }),
      ...(wasNew
        ? [this.prisma.lead.update({ where: { id: lead.id }, data: { crmStatus: "contacted", contactedAt: new Date() } })]
        : []),
    ]);
    if (wasNew) {
      void this.notifier.emit(lead.workspaceId, "lead.status_changed", {
        lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, website: lead.website, score: lead.score, priority: lead.priority },
        from: "new",
        to: "contacted",
      });
    }
  }

  // ─── Consultas ─────────────────────────────────────────────────────────────

  async listForLead(workspaceId: string, leadId: string) {
    return this.prisma.emailMessage.findMany({
      where: { workspaceId, leadId },
      orderBy: { createdAt: "desc" },
      include: { events: { orderBy: { occurredAt: "asc" } } },
    });
  }

  async campaignStats(workspaceId: string, campaignId: string) {
    const where = { workspaceId, campaignId };
    const [total, queued, sent, delivered, bounced, complained, failed, opened, clicked, replied, leadsWithEmail] = await Promise.all([
      this.prisma.emailMessage.count({ where }),
      this.prisma.emailMessage.count({ where: { ...where, status: "queued" } }),
      this.prisma.emailMessage.count({ where: { ...where, sentAt: { not: null } } }),
      this.prisma.emailMessage.count({ where: { ...where, deliveredAt: { not: null } } }),
      this.prisma.emailMessage.count({ where: { ...where, bouncedAt: { not: null } } }),
      this.prisma.emailMessage.count({ where: { ...where, complainedAt: { not: null } } }),
      this.prisma.emailMessage.count({ where: { ...where, status: "failed" } }),
      this.prisma.emailMessage.count({ where: { ...where, firstOpenedAt: { not: null } } }),
      this.prisma.emailMessage.count({ where: { ...where, firstClickedAt: { not: null } } }),
      this.prisma.emailMessage.count({ where: { ...where, repliedAt: { not: null } } }),
      this.prisma.lead.count({ where: { workspaceId, campaignId, NOT: [{ email: null }, { email: "" }] } }),
    ]);
    return { total, queued, sent, delivered, bounced, complained, failed, opened, clicked, replied, leadsWithEmail };
  }

  /** Leads da campanha aptos a receber: têm e-mail + texto da IA, nunca receberam e não estão bloqueados. */
  async eligibleLeadIds(workspaceId: string, campaignId: string): Promise<string[]> {
    const leads = await this.prisma.lead.findMany({
      where: { workspaceId, campaignId, NOT: [{ email: null }, { email: "" }], emails: { none: {} } },
      select: { id: true, email: true, marketingContent: true },
      orderBy: { score: "desc" },
    });
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { emailTemplate: true } });
    const template = (campaign?.emailTemplate ?? null) as { subject?: string; body?: string } | null;
    const hasTemplate = !!(template?.subject && template?.body);
    const suppressed = new Set(
      (await this.prisma.emailSuppression.findMany({ where: { workspaceId }, select: { email: true } })).map((s) => s.email),
    );
    return leads
      .filter((l) => {
        const c = (l.marketingContent ?? {}) as { email?: { subject?: string; body?: string } };
        return (hasTemplate || (c.email?.subject && c.email?.body)) && !suppressed.has(l.email!.trim().toLowerCase());
      })
      .map((l) => l.id);
  }

  // ─── Descadastro ───────────────────────────────────────────────────────────

  async unsubscribe(messageId: string) {
    const msg = await this.prisma.emailMessage.findUnique({ where: { id: messageId } });
    if (!msg) return false;
    await this.suppress(msg.workspaceId, msg.toEmail, "unsubscribe");
    await this.prisma.emailEvent.create({ data: { messageId: msg.id, type: "unsubscribe" } });
    await this.prisma.leadActivity.create({
      data: { leadId: msg.leadId, type: "email_unsubscribed", note: "Pediu para não receber mais e-mails" },
    });
    return true;
  }

  private async suppress(workspaceId: string, email: string, reason: string) {
    await this.prisma.emailSuppression.upsert({
      where: { workspaceId_email: { workspaceId, email: email.trim().toLowerCase() } },
      create: { workspaceId, email: email.trim().toLowerCase(), reason },
      update: {},
    });
  }

  // ─── Eventos do SES (via SNS) ──────────────────────────────────────────────

  async handleSesNotification(raw: string) {
    let event: SesEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      this.logger.warn("Notificação SNS sem JSON do SES — ignorada");
      return;
    }
    if (event.notificationType === "Received") return this.handleInbound(event);

    const type = (event.eventType ?? event.notificationType ?? "").toLowerCase();
    const ourId = event.mail?.tags?.prospex_message?.[0];
    const msg = ourId
      ? await this.prisma.emailMessage.findUnique({ where: { id: ourId } })
      : await this.prisma.emailMessage.findUnique({ where: { sesMessageId: event.mail?.messageId ?? "" } });
    if (!msg) return; // e-mail de outro sistema que usa a mesma conta SES

    const at = (ts?: string) => (ts ? new Date(ts) : new Date());
    const data: Record<string, unknown> = {};
    let eventData: Record<string, unknown> | undefined;

    switch (type) {
      case "delivery":
        data.deliveredAt = at(event.delivery?.timestamp);
        if (msg.status === "sent") data.status = "delivered";
        break;
      case "bounce": {
        data.bouncedAt = new Date();
        data.status = "bounced";
        eventData = { bounceType: event.bounce?.bounceType, subType: event.bounce?.bounceSubType, diagnostic: event.bounce?.bouncedRecipients?.[0]?.diagnosticCode };
        // Só a devolução permanente bloqueia; a temporária (caixa cheia etc.) pode dar certo depois.
        if (event.bounce?.bounceType === "Permanent") await this.suppress(msg.workspaceId, msg.toEmail, "bounce");
        break;
      }
      case "complaint":
        data.complainedAt = new Date();
        data.status = "complained";
        await this.suppress(msg.workspaceId, msg.toEmail, "complaint");
        break;
      case "open":
        data.openCount = { increment: 1 };
        if (!msg.firstOpenedAt) data.firstOpenedAt = at(event.open?.timestamp);
        eventData = { userAgent: event.open?.userAgent };
        break;
      case "click":
        // O link de descadastro também é rastreado pelo SES: não conta como interesse.
        if (event.click?.link?.includes("/api/email/unsubscribe")) return;
        data.clickCount = { increment: 1 };
        if (!msg.firstClickedAt) data.firstClickedAt = at(event.click?.timestamp);
        eventData = { link: event.click?.link, userAgent: event.click?.userAgent };
        break;
      case "reject":
      case "rendering failure":
        data.status = "failed";
        data.error = event.reject?.reason ?? event.failure?.errorMessage ?? type;
        break;
      case "send":
        break;
      default:
        return;
    }

    await this.prisma.$transaction([
      this.prisma.emailEvent.create({ data: { messageId: msg.id, type: type.replace(" ", "_"), data: eventData as object | undefined } }),
      ...(Object.keys(data).length ? [this.prisma.emailMessage.update({ where: { id: msg.id }, data })] : []),
    ]);
  }

  /** Resposta do lead: chega pelo recebimento do SES (MX do replyDomain) e vira "respondeu" no CRM. */
  private async handleInbound(event: SesEvent) {
    const recipients = [...(event.receipt?.recipients ?? []), ...(event.mail.destination ?? [])];
    const ourId = recipients.map((r) => REPLY_RE.exec(r)?.[1]).find(Boolean);
    if (!ourId) {
      this.logger.warn(`E-mail recebido sem destinatário r+<id>: ${recipients.join(", ")}`);
      return;
    }
    const msg = await this.prisma.emailMessage.findUnique({ where: { id: ourId }, include: { lead: true } });
    if (!msg) return;

    let text = "";
    let fromAddress = event.mail.commonHeaders?.from?.[0] ?? "";
    let subject = event.mail.commonHeaders?.subject ?? "";
    if (event.content) {
      const rawMime = event.receipt?.action?.encoding === "BASE64" ? Buffer.from(event.content, "base64") : event.content;
      const parsed = await simpleParser(rawMime);
      text = (parsed.text ?? "").trim();
      fromAddress = parsed.from?.text ?? fromAddress;
      subject = parsed.subject ?? subject;
    }
    // Guarda só a resposta nova, sem o histórico citado ("Em ... escreveu:").
    const reply = text.split(/\n(?:Em .+escreveu:|On .+wrote:|-{2,}\s*Original|De: )/i)[0].trim().slice(0, 5000);

    const wasEarly = ["new", "contacted"].includes(msg.lead.crmStatus);
    await this.prisma.$transaction([
      this.prisma.emailEvent.create({ data: { messageId: msg.id, type: "reply", data: { from: fromAddress, subject, text: reply } } }),
      this.prisma.emailMessage.update({ where: { id: msg.id }, data: { repliedAt: msg.repliedAt ?? new Date() } }),
      this.prisma.leadActivity.create({
        data: { leadId: msg.leadId, type: "email_replied", note: reply ? `Respondeu: ${reply.slice(0, 280)}` : "Respondeu o e-mail", metadata: { messageId: msg.id, from: fromAddress } },
      }),
      ...(wasEarly
        ? [this.prisma.lead.update({ where: { id: msg.leadId }, data: { crmStatus: "replied", repliedAt: new Date() } })]
        : []),
    ]);
    if (wasEarly) {
      const l = msg.lead;
      void this.notifier.emit(msg.workspaceId, "lead.status_changed", {
        lead: { id: l.id, name: l.name, phone: l.phone, email: l.email, website: l.website, score: l.score, priority: l.priority },
        from: l.crmStatus,
        to: "replied",
      });
    }
    await this.forwardReply(msg.workspaceId, msg.lead.name, fromAddress, subject, reply).catch((e) =>
      this.logger.warn(`Falha ao encaminhar resposta: ${e}`),
    );
  }

  /** Cópia da resposta para uma caixa humana; o Reply-To aponta para o lead, então dá para responder direto. */
  private async forwardReply(workspaceId: string, leadName: string, from: string, subject: string, reply: string) {
    const cfg = (await this.settings.getIntegrationConfig(workspaceId, "ses")) as SesConfig | null;
    if (!cfg?.forwardRepliesTo || !cfg.fromEmail) return;
    const leadAddress = /<([^>]+)>/.exec(from)?.[1] ?? from;
    await this.client(cfg).send(
      new SendEmailCommand({
        FromEmailAddress: cfg.fromEmail,
        Destination: { ToAddresses: [cfg.forwardRepliesTo] },
        ReplyToAddresses: leadAddress ? [leadAddress] : undefined,
        Content: {
          Simple: {
            Subject: { Data: `[WishLead] ${leadName} respondeu: ${subject}`, Charset: "UTF-8" },
            Body: { Text: { Data: `${leadName} (${from}) respondeu:\n\n${reply || "(sem texto)"}\n\n— Responda este e-mail para falar direto com o lead.`, Charset: "UTF-8" } },
          },
        },
      }),
    );
  }
}
