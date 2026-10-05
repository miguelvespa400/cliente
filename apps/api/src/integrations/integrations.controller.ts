import { Body, Controller, Get, Param, Post, UseGuards, BadRequestException, NotFoundException } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { JwtGuard } from "../auth/jwt.guard";
import { WorkspaceId } from "../auth/current-workspace.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { NotifierService } from "./notifier.service";
import { WhatsAppService } from "./whatsapp.service";

class SendWhatsAppDto {
  @IsIn(["template", "text"]) mode: "template" | "text";
  @IsOptional() @IsString() @MaxLength(4096) text?: string;
}

@ApiTags("integrations")
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller("integrations")
export class IntegrationsController {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private notifier: NotifierService,
    private whatsapp: WhatsAppService,
  ) {}

  @Post(":type/test")
  @ApiOperation({ summary: "Testa a integração (webhook, telegram ou whatsapp)" })
  async test(@Param("type") type: string, @WorkspaceId() workspaceId: string) {
    if (type === "whatsapp") return this.whatsapp.verify(workspaceId);

    const cfg = await this.settings.getIntegrationConfig(workspaceId, type);
    if (!cfg) throw new BadRequestException("Salve a integração antes de testar");

    if (type === "webhook") {
      if (!cfg.url) throw new BadRequestException("Informe a URL do webhook");
      return this.notifier.sendWebhook(cfg, "test", workspaceId, { message: "Teste do Prospex: integração funcionando" });
    }
    if (type === "telegram") {
      if (!cfg.botToken || !cfg.chatId) throw new BadRequestException("Informe o token do bot e o ID do chat");
      return this.notifier.sendTelegram(cfg, this.notifier.formatTelegram("test", {}));
    }
    throw new BadRequestException("Esta integração não tem teste");
  }

  @Get("whatsapp/templates")
  @ApiOperation({ summary: "Modelos de mensagem aprovados na conta WhatsApp Business" })
  templates(@WorkspaceId() workspaceId: string) {
    return this.whatsapp.listTemplates(workspaceId);
  }

  @Post("whatsapp/send/:leadId")
  @ApiOperation({ summary: "Envia a abordagem do lead pela WhatsApp Cloud API" })
  async sendWhatsApp(@Param("leadId") leadId: string, @Body() dto: SendWhatsAppDto, @WorkspaceId() workspaceId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, workspaceId } });
    if (!lead) throw new NotFoundException("Lead não encontrado");
    if (!lead.phone) throw new BadRequestException("Este lead não tem telefone.");

    const content = (lead.marketingContent ?? {}) as { whatsapp?: string };
    const message = dto.text?.trim() || content.whatsapp || "";
    if (!message) throw new BadRequestException("Este lead ainda não tem mensagem de WhatsApp gerada.");

    const result = await this.whatsapp.send(workspaceId, lead.phone, { mode: dto.mode, businessName: lead.name, message });

    const wasNew = lead.crmStatus === "new";
    await this.prisma.$transaction([
      this.prisma.leadActivity.create({
        data: {
          leadId,
          type: "whatsapp_sent",
          note: dto.mode === "template" ? "WhatsApp enviado (modelo aprovado)" : "WhatsApp enviado (texto)",
          metadata: { messageId: result.messageId, to: result.to, mode: result.mode },
        },
      }),
      ...(wasNew
        ? [this.prisma.lead.update({ where: { id: leadId }, data: { crmStatus: "contacted", contactedAt: new Date() } })]
        : []),
    ]);
    if (wasNew) {
      void this.notifier.emit(workspaceId, "lead.status_changed", {
        lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, website: lead.website, score: lead.score, priority: lead.priority },
        from: "new",
        to: "contacted",
      });
    }
    return { ...result, crmStatus: wasNew ? "contacted" : lead.crmStatus };
  }
}
