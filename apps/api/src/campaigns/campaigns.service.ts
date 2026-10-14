import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCampaignDto } from "./dto/create-campaign.dto";
import { UpdateCampaignDto } from "./dto/update-campaign.dto";

const DEFAULT_WORKSPACE_ID = "default-workspace";

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId = DEFAULT_WORKSPACE_ID) {
    return this.prisma.campaign.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { leads: true } } },
    });
  }

  async findOne(id: string, workspaceId = DEFAULT_WORKSPACE_ID) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, workspaceId },
      include: { _count: { select: { leads: true } } },
    });
    if (!campaign) throw new NotFoundException(`Campanha ${id} não encontrada`);
    return campaign;
  }

  async create(dto: CreateCampaignDto, workspaceId = DEFAULT_WORKSPACE_ID) {
    await this.prisma.workspace.upsert({
      where: { id: workspaceId },
      create: { id: workspaceId, name: "Default Workspace", slug: "default" },
      update: {},
    });
    return this.prisma.campaign.create({
      data: {
        ...dto,
        maxResults: dto.maxResults ?? 20,
        contentStyle: dto.contentStyle ?? "balanced",
        language: dto.language ?? "portuguese",
        workspaceId,
      },
    });
  }

  /** Copia só a configuração; a cópia nasce como rascunho, sem leads nem estatísticas. */
  async duplicate(id: string, workspaceId = DEFAULT_WORKSPACE_ID) {
    const source = await this.findOne(id, workspaceId);
    return this.prisma.campaign.create({
      data: {
        name: `${source.name} (cópia)`,
        description: source.description,
        industry: source.industry,
        location: source.location,
        searchQueries: source.searchQueries,
        maxResults: source.maxResults,
        yourService: source.yourService,
        contentStyle: source.contentStyle,
        language: source.language,
        workspaceId: source.workspaceId,
      },
    });
  }

  async update(id: string, dto: UpdateCampaignDto, workspaceId = DEFAULT_WORKSPACE_ID) {
    const campaign = await this.findOne(id, workspaceId);
    // Depois de rodar, a configuração precisa bater com os leads coletados.
    if (campaign.status !== "draft") throw new BadRequestException("Só é possível editar campanhas em rascunho");
    return this.prisma.campaign.update({ where: { id }, data: dto });
  }

  async remove(id: string, workspaceId = DEFAULT_WORKSPACE_ID) {
    await this.findOne(id, workspaceId);
    return this.prisma.campaign.delete({ where: { id } });
  }

  async updateStatus(id: string, status: string, progress?: number, error?: string) {
    return this.prisma.campaign.update({
      where: { id },
      data: {
        status,
        ...(progress !== undefined && { progress }),
        ...(error && { error }),
        ...(status === "running" && { startedAt: new Date() }),
        ...(status === "completed" && { completedAt: new Date() }),
      },
    });
  }

  async updateStats(id: string, stats: {
    totalLeads?: number;
    priorityLeads?: number;
    highQualityLeads?: number;
    averageScore?: number;
  }) {
    return this.prisma.campaign.update({ where: { id }, data: stats });
  }
}
