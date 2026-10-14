import { Body, Controller, Get, Param, Post, UseGuards, BadRequestException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { JwtGuard } from "../auth/jwt.guard";
import { WorkspaceId } from "../auth/current-workspace.decorator";
import { CampaignsService } from "../campaigns/campaigns.service";
import { EmailService } from "./email.service";

class SendEmailDto {
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
  ) {}

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
