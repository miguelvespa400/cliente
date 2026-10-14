import { Controller, Get, Post, Query, Body, Header, HttpCode, Logger, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { EmailService } from "./email.service";
import { parseUnsubscribeToken } from "./email-render";
import { verifySnsMessage, type SnsMessage } from "./sns-verify";

// Rotas públicas (sem login): eventos do SES via SNS e o link de descadastro.
@ApiExcludeController()
@SkipThrottle()
@Controller("email")
export class EmailPublicController {
  private readonly logger = new Logger(EmailPublicController.name);

  constructor(private email: EmailService, private config: ConfigService) {}

  @Post("sns")
  @HttpCode(200)
  async sns(@Body() body: string | SnsMessage) {
    // O SNS manda JSON com Content-Type text/plain.
    const msg: SnsMessage = typeof body === "string" ? JSON.parse(body) : body;
    if (!(await verifySnsMessage(msg).catch(() => false))) throw new ForbiddenException("Assinatura SNS inválida");

    // Fail-closed: sem a lista de tópicos configurada, nenhum aviso é aceito — a assinatura
    // só prova que veio da AWS, não que veio da NOSSA conta.
    const allowed = this.config.get<string>("SES_SNS_TOPIC_ARN", "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(msg.TopicArn)) throw new ForbiddenException("Tópico SNS não autorizado");

    if (msg.Type === "SubscriptionConfirmation" && msg.SubscribeURL) {
      await fetch(msg.SubscribeURL, { signal: AbortSignal.timeout(5000) });
      this.logger.log(`Assinatura SNS confirmada: ${msg.TopicArn}`);
      return { ok: true };
    }
    if (msg.Type === "Notification") await this.email.handleSesNotification(msg.Message);
    return { ok: true };
  }

  @Get("unsubscribe")
  @Header("Content-Type", "text/html; charset=utf-8")
  async unsubscribePage(@Query("t") token: string) {
    const ok = await this.doUnsubscribe(token);
    const text = ok
      ? "Pronto. Você não vai mais receber nossos e-mails."
      : "Link de descadastro inválido ou expirado.";
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Descadastro</title></head><body style="font-family:Arial,sans-serif;max-width:480px;margin:80px auto;padding:0 16px;color:#222"><p>${text}</p></body></html>`;
  }

  // Descadastro com 1 clique (RFC 8058): o Gmail faz POST direto, sem abrir a página.
  @Post("unsubscribe")
  @HttpCode(200)
  async unsubscribeOneClick(@Query("t") token: string) {
    return { ok: await this.doUnsubscribe(token) };
  }

  private async doUnsubscribe(token: string): Promise<boolean> {
    const id = parseUnsubscribeToken(token, this.config.get<string>("JWT_SECRET")!);
    return id ? this.email.unsubscribe(id) : false;
  }
}
