import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotifierService } from "../integrations/notifier.service";
import { UpdateCrmDto } from "./dto/update-crm.dto";
import { UpdateContentDto } from "./dto/update-content.dto";
import { dedupeKeys } from "../scraper/dedupe";
import { CRM_STATUSES, CreateLeadDto, UpdateLeadDto } from "./dto/lead-form.dto";

const DEFAULT_WORKSPACE_ID = "default-workspace";

export interface LeadFilter {
  campaignId?: string;
  q?: string;
  priority?: string;
  status?: string;
  ownerId?: string;
  page?: number;
  limit?: number;
}

const CRM_STATUS_PT: Record<string, string> = {
  new: "Novo", contacted: "Contatado", replied: "Respondeu", meeting: "Reunião", proposal: "Proposta", won: "Ganho", lost: "Perdido",
};

/** Cards por coluna no funil (o total de cada etapa vem à parte). */
const PIPELINE_LIMIT = 100;

const OWNER = { select: { id: true, name: true } } as const;
const NEXT_TASK = {
  where: { done: false },
  orderBy: { scheduledAt: "asc" as const },
  take: 1,
  select: { id: true, type: true, note: true, scheduledAt: true },
};

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBr = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

function searchWhere(q?: string): Prisma.LeadWhereInput {
  if (!q) return {};
  const contains = { contains: q, mode: "insensitive" as const };
  return { OR: [{ name: contains }, { contactName: contains }, { phone: { contains: q } }, { email: contains }] };
}

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private notifier: NotifierService,
  ) {}

  async findAll(workspaceId = DEFAULT_WORKSPACE_ID, filter: LeadFilter = {}) {
    const { campaignId, q, priority, status, ownerId, page = 1, limit = 50 } = filter;
    const skip = (page - 1) * limit;

    const where: Prisma.LeadWhereInput = {
      workspaceId,
      ...(campaignId && { campaignId }),
      ...(priority && { priority }),
      ...(status && { crmStatus: status }),
      ...(ownerId && { ownerId }),
      ...searchWhere(q),
    };

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: [{ priority: "asc" }, { score: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
        include: {
          activities: { orderBy: { createdAt: "desc" }, take: 5 },
          campaign: { select: { id: true, name: true } },
          owner: OWNER,
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /** Funil (Kanban): uma coluna por status, com quantidade e soma dos valores da etapa. */
  async pipeline(workspaceId = DEFAULT_WORKSPACE_ID, filter: { ownerId?: string; q?: string } = {}) {
    const where: Prisma.LeadWhereInput = {
      workspaceId,
      ...(filter.ownerId && { ownerId: filter.ownerId }),
      ...searchWhere(filter.q),
    };
    const [groups, ...columns] = await Promise.all([
      this.prisma.lead.groupBy({ by: ["crmStatus"], where, _count: { _all: true }, _sum: { dealValue: true } }),
      ...CRM_STATUSES.map((status) =>
        this.prisma.lead.findMany({
          where: { ...where, crmStatus: status },
          orderBy: { updatedAt: "desc" },
          take: PIPELINE_LIMIT,
          select: {
            id: true, name: true, contactName: true, phone: true, email: true, dealValue: true, priority: true, score: true,
            crmStatus: true, source: true, expectedCloseDate: true, ownerId: true, updatedAt: true,
            owner: OWNER, campaign: { select: { id: true, name: true } }, followUps: NEXT_TASK,
          },
        }),
      ),
    ]);
    return {
      stages: CRM_STATUSES.map((status, i) => {
        const g = groups.find((x) => x.crmStatus === status);
        return {
          status,
          count: g?._count._all ?? 0,
          value: g?._sum.dealValue ?? 0,
          leads: columns[i].map(({ followUps, ...l }) => ({ ...l, nextTask: followUps[0] ?? null })),
        };
      }),
    };
  }

  async findOne(id: string, workspaceId = DEFAULT_WORKSPACE_ID) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, workspaceId },
      include: {
        activities: { orderBy: { createdAt: "desc" } },
        campaign: { select: { id: true, name: true } },
        owner: OWNER,
        followUps: { orderBy: [{ done: "asc" }, { scheduledAt: "asc" }] },
      },
    });
    if (!lead) throw new NotFoundException(`Lead ${id} não encontrado`);
    const { followUps, ...rest } = lead;
    return { ...rest, tasks: followUps };
  }

  async create(dto: CreateLeadDto, workspaceId: string, userId?: string) {
    const ownerId = dto.ownerId ?? userId ?? null;
    if (ownerId) await this.assertMember(workspaceId, ownerId);
    const status = dto.crmStatus ?? "new";
    const now = new Date();
    const lead = await this.prisma.lead.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        contactName: dto.contactName ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        website: dto.website ?? null,
        address: dto.address ?? null,
        category: dto.category ?? null,
        hasWebsite: !!dto.website,
        dealValue: dto.dealValue ?? null,
        ownerId,
        expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null,
        crmNotes: dto.crmNotes ?? null,
        crmStatus: status,
        priority: dto.priority ?? "MEDIUM",
        source: "manual",
        ...(status === "contacted" && { contactedAt: now }),
        ...(["won", "lost"].includes(status) && { closedAt: now }),
      },
    });
    await this.prisma.leadActivity.create({
      data: { leadId: lead.id, type: "lead_created", note: `Cadastrado manualmente em ${CRM_STATUS_PT[status]}` },
    });
    return this.findOne(lead.id, workspaceId);
  }

  async update(id: string, dto: UpdateLeadDto, workspaceId = DEFAULT_WORKSPACE_ID) {
    const before = await this.findOne(id, workspaceId);
    if (dto.ownerId) await this.assertMember(workspaceId, dto.ownerId);
    const { expectedCloseDate, ...fields } = dto;
    const data: Prisma.LeadUncheckedUpdateInput = {
      ...fields,
      ...(fields.name !== undefined && { name: fields.name.trim() }),
      ...(fields.website !== undefined && { hasWebsite: !!fields.website }),
      ...(expectedCloseDate !== undefined && { expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null }),
    };
    const lead = await this.prisma.lead.update({ where: { id }, data, include: { owner: OWNER } });

    const changes: string[] = [];
    if (dto.dealValue !== undefined && dto.dealValue !== before.dealValue) {
      changes.push(dto.dealValue == null ? "valor removido" : `valor ${brl(dto.dealValue)}`);
    }
    if (dto.ownerId !== undefined && dto.ownerId !== before.ownerId) {
      changes.push(lead.owner ? `responsável ${lead.owner.name}` : "sem responsável");
    }
    if (expectedCloseDate !== undefined && lead.expectedCloseDate?.getTime() !== before.expectedCloseDate?.getTime()) {
      changes.push(lead.expectedCloseDate ? `previsão ${dateBr(lead.expectedCloseDate)}` : "previsão removida");
    }
    if (dto.crmNotes !== undefined && dto.crmNotes !== before.crmNotes) changes.push("observações");
    const contactKeys = ["name", "contactName", "phone", "email", "website", "address", "category", "priority"] as const;
    if (contactKeys.some((k) => dto[k] !== undefined && dto[k] !== before[k])) changes.push("dados de contato");
    if (changes.length) {
      await this.prisma.leadActivity.create({
        data: { leadId: id, type: "deal_updated", note: `Atualizado: ${changes.join(", ")}` },
      });
    }
    return this.findOne(id, workspaceId);
  }

  async remove(id: string, workspaceId = DEFAULT_WORKSPACE_ID) {
    await this.findOne(id, workspaceId);
    await this.prisma.lead.delete({ where: { id } });
    return { ok: true };
  }

  async updateCrm(id: string, dto: UpdateCrmDto, workspaceId = DEFAULT_WORKSPACE_ID) {
    const before = await this.findOne(id, workspaceId);
    if (dto.crmStatus && !CRM_STATUSES.includes(dto.crmStatus)) throw new BadRequestException("Status inválido");
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
    if (dto.crmStatus && dto.crmStatus !== before.crmStatus) {
      await this.prisma.leadActivity.create({
        data: {
          leadId: id,
          type: "crm_update",
          note: `Status alterado para ${CRM_STATUS_PT[dto.crmStatus] ?? dto.crmStatus}`,
          metadata: dto as object,
        },
      });
      // Não bloqueia a resposta: Webhook/Telegram recebem o aviso em segundo plano.
      void this.notifier.emit(workspaceId, "lead.status_changed", {
        lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, website: lead.website, score: lead.score, priority: lead.priority },
        from: before.crmStatus,
        to: dto.crmStatus,
      });
    }
    return lead;
  }

  private async assertMember(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (!member) throw new BadRequestException("O responsável precisa ser um membro deste workspace");
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
