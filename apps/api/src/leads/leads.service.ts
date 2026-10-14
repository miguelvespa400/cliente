import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotifierService } from "../integrations/notifier.service";
import { UpdateCrmDto } from "./dto/update-crm.dto";
import { UpdateContentDto } from "./dto/update-content.dto";
import { dedupeKeys } from "../scraper/dedupe";

const DEFAULT_WORKSPACE_ID = "default-workspace";

export interface LeadFilter {
  campaignId?: string;
  q?: string;
  priority?: string;
  status?: string;
  page?: number;
  limit?: number;
}

const CRM_STATUS_PT: Record<string, string> = {
  new: "Novo", contacted: "Contatado", replied: "Respondeu", meeting: "Reunião", proposal: "Proposta", won: "Ganho", lost: "Perdido",
};

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private notifier: NotifierService,
  ) {}

  async findAll(workspaceId = DEFAULT_WORKSPACE_ID, filter: LeadFilter = {}) {
    const { campaignId, q, priority, status, page = 1, limit = 50 } = filter;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId,
      ...(campaignId && { campaignId }),
      ...(priority && { priority }),
      ...(status && { crmStatus: status }),
      ...(q && { name: { contains: q, mode: "insensitive" as const } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: [{ priority: "asc" }, { score: "desc" }],
        skip,
        take: limit,
        include: {
          activities: { orderBy: { createdAt: "desc" }, take: 5 },
          campaign: { select: { id: true, name: true } },
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, workspaceId = DEFAULT_WORKSPACE_ID) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, workspaceId },
      include: {
        activities: { orderBy: { createdAt: "desc" } },
        campaign: { select: { id: true, name: true } },
        followUps: { where: { done: false }, orderBy: { scheduledAt: "asc" } },
      },
    });
    if (!lead) throw new NotFoundException(`Lead ${id} não encontrado`);
    return lead;
  }

  async updateCrm(id: string, dto: UpdateCrmDto, workspaceId = DEFAULT_WORKSPACE_ID) {
    const before = await this.findOne(id, workspaceId);
    const now = new Date();
    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.crmStatus === "contacted" && { contactedAt: now }),
        ...(dto.crmStatus === "replied" && { repliedAt: now }),
        ...(["won", "lost"].includes(dto.crmStatus ?? "") && { closedAt: now }),
      },
    });
    await this.prisma.leadActivity.create({
      data: {
        leadId: id,
        type: "crm_update",
        note: `Status alterado para ${CRM_STATUS_PT[dto.crmStatus] ?? dto.crmStatus}`,
        metadata: dto as object,
      },
    });
    if (dto.crmStatus && dto.crmStatus !== before.crmStatus) {
      // Não bloqueia a resposta: Webhook/Telegram recebem o aviso em segundo plano.
      void this.notifier.emit(workspaceId, "lead.status_changed", {
        lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, website: lead.website, score: lead.score, priority: lead.priority },
        from: before.crmStatus,
        to: dto.crmStatus,
      });
    }
    return lead;
  }

  async createMany(leads: Array<{
    name: string;
    address?: string;
    lat?: number;
    lng?: number;
    phone?: string;
    email?: string;
    category?: string;
    source?: string;
    website?: string;
    rating?: string;
    reviewCount?: number;
    hasWebsite?: boolean;
    referenceUrl?: string;
    score?: number;
    priority?: string;
    marketingContent?: object;
    aiAnalysis?: object;
    campaignId: string;
    workspaceId: string;
  }>) {
    return this.prisma.lead.createMany({ data: leads, skipDuplicates: true });
  }

  async updateContent(id: string, dto: UpdateContentDto, workspaceId = DEFAULT_WORKSPACE_ID) {
    const lead = await this.findOne(id, workspaceId);
    const current = (lead.marketingContent ?? {}) as Record<string, unknown> & { email?: { subject?: string; body?: string } };
    const next: Record<string, unknown> = { ...current };
    if (dto.emailSubject !== undefined || dto.emailBody !== undefined) {
      next.email = {
        subject: (dto.emailSubject ?? current.email?.subject ?? "").trim(),
        body: (dto.emailBody ?? current.email?.body ?? "").trim(),
        // Editado à mão: o envio usa este texto, e não o texto padrão da campanha.
        edited: true,
      };
    }
    if (dto.whatsapp !== undefined) next.whatsapp = dto.whatsapp.trim();
    if (dto.instagram !== undefined) next.instagram = dto.instagram.trim();
    await this.prisma.lead.update({ where: { id: lead.id }, data: { marketingContent: next as object } });
    return this.findOne(id, workspaceId);
  }

  async existingDedupeKeys(workspaceId: string): Promise<Set<string>> {
    const leads = await this.prisma.lead.findMany({
      where: { workspaceId },
      select: { name: true, phone: true, email: true },
    });
    return new Set(leads.flatMap((l) => dedupeKeys(l)));
  }
}
