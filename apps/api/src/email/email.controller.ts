import { Body, Controller, Get, Param, Post, Put, UseGuards, BadRequestException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { JwtGuard } from "../auth/jwt.guard";
import { WorkspaceId } from "../auth/current-workspace.decorator";
import { CampaignsService } from "../campaigns/campaigns.service";
import { MarketingAiService } from "../ai/marketing-ai.service";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "./email.service";

class SendEmailDto {
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(20000) body?: string;
}

class EmailTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(300) subject: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) body: string;
}

class GenerateTemplateDto {
  @IsOptional() @IsString() @MaxLength(2000) instructions?: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(20000) body?: string;
}

@ApiTags("email")
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller("email")
export class EmailController {
  constructor(
    private email: EmailService,
    private campaigns: CampaignsService,
    @InjectQueue("email") private queue: Queue<{ messageId: string }>,
    private ai: MarketingAiService,
    private prisma: PrismaService,
  ) {}

  @Get("campaigns/:id/template")
  @ApiOperation({ summary: "Texto padrão do e-mail da campanha (null = usa o texto gerado por lead)" })
  async getTemplate(@Param("id") id: string, @WorkspaceId() workspaceId: string) {
    const campaign = await this.campaigns.findOne(id, workspaceId);
    return { template: campaign.emailTemplate ?? null };
  }

  @Put("campaigns/:id/template")
  @ApiOperation({ summary: "Salva o texto padrão do e-mail da campanha" })
  async saveTemplate(@Param("id") id: string, @Body() dto: EmailTemplateDto, @WorkspaceId() workspaceId: string) {
    await this.campaigns.findOne(id, workspaceId);
    const template = { subject: dto.subject.trim(), body: dto.body.trim() };
    await this.prisma.campaign.update({ where: { id }, data: { emailTemplate: template } });
    return { template };
  }

  @Post("campaigns/:id/template/generate")
  @ApiOperation({ summary: "Gera (ou reescreve) o texto padrão com IA a partir das instruções e do texto atual; não salva" })
  async generateTemplate(@Param("id") id: string, @Body() dto: GenerateTemplateDto, @WorkspaceId() workspaceId: string) {
    const campaign = await this.campaigns.findOne(id, workspaceId);
    try {
      const template = await this.ai.generateEmailTemplate(
        {
          industry: campaign.industry,
          yourService: campaign.yourService,
          contentStyle: campaign.contentStyle,
          language: campaign.language,
          instructions: dto.instructions?.trim(),
          current: { subject: dto.subject, body: dto.body },
        },
        workspaceId,
      );
      return { template };
    } catch (e) {
      throw new BadRequestException(`Falha ao gerar com IA: ${e instanceof Error ? e.message : e}`);
    }
  }

  @Post("test")
  @ApiOperation({ summary: "Testa as credenciais do Amazon SES" })
  test(@WorkspaceId() workspaceId: string) {
    return this.email.verify(workspaceId);
  }

  @Post("leads/:leadId/send")
  @ApiOperation({ summary: "Envia agora o e-mail de abordagem do lead (texto da IA ou editado)" })
  async sendToLead(@Param("leadId") leadId: string, @Body() dto: SendEmailDto, @WorkspaceId() workspaceId: string) {
    const msg = await this.email.prepare(workspaceId, leadId, dto);
    return this.email.deliver(msg.id);
  }

  @Get("leads/:leadId")
  @ApiOperation({ summary: "E-mails enviados ao lead, com os eventos (entrega, abertura, clique, resposta)" })
  listForLead(@Param("leadId") leadId: string, @WorkspaceId() workspaceId: string) {
    return this.email.listForLead(workspaceId, leadId);
  }

  @Get("campaigns/:id/stats")
  @ApiOperation({ summary: "Funil de e-mail da campanha" })
  async campaignStats(@Param("id") id: string, @WorkspaceId() workspaceId: string) {
    await this.campaigns.findOne(id, workspaceId);
    const cfg = await this.email.getConfig(workspaceId).catch(() => null);
    const [stats, eligible, sentToday] = await Promise.all([
      this.email.campaignStats(workspaceId, id),
      this.email.eligibleLeadIds(workspaceId, id),
      this.email.sentLast24h(workspaceId),
    ]);
    return { ...stats, eligible: eligible.length, sentToday, dailyLimit: Number(cfg?.dailyLimit) || 50, configured: !!cfg };
  }

  @Post("campaigns/:id/send")
  @ApiOperation({ summary: "Envia em lote para os leads da campanha que ainda não receberam (respeita o limite diário)" })
  async sendCampaign(@Param("id") id: string, @WorkspaceId() workspaceId: string) {
    await this.campaigns.findOne(id, workspaceId);
    const cfg = await this.email.getConfig(workspaceId);
    const limit = Number(cfg.dailyLimit) || 50;
    const remaining = limit - (await this.email.sentLast24h(workspaceId));
    if (remaining <= 0) throw new BadRequestException(`Limite diário de ${limit} e-mails já atingido.`);

    const eligible = await this.email.eligibleLeadIds(workspaceId, id);
    // Só enfileira o que cabe no limite de hoje; o resto fica para o próximo envio.
    const batch = eligible.slice(0, remaining);
    for (const leadId of batch) {
      const msg = await this.email.prepare(workspaceId, leadId);
      await this.queue.add("send", { messageId: msg.id }, { removeOnComplete: 500, removeOnFail: 500 });
    }
    return { queued: batch.length, leftForLater: eligible.length - batch.length };
  }
}
