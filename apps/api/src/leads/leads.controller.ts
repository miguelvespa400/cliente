import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from "@nestjs/swagger";
import { LeadsService } from "./leads.service";
import { UpdateCrmDto } from "./dto/update-crm.dto";
import { CreateLeadDto, UpdateLeadDto } from "./dto/lead-form.dto";
import { JwtGuard } from "../auth/jwt.guard";
import { WorkspaceId } from "../auth/current-workspace.decorator";
import { CurrentUserId } from "../auth/current-user.decorator";

@ApiTags("Leads")
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller("leads")
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @ApiOperation({ summary: "List all leads" })
  @ApiQuery({ name: "campaignId", required: false })
  @ApiQuery({ name: "q", required: false, description: "Busca por nome, contato, telefone ou e-mail" })
  @ApiQuery({ name: "priority", required: false, enum: ["HIGH", "MEDIUM", "LOW"] })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "ownerId", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  findAll(
    @WorkspaceId() workspaceId: string,
    @Query("campaignId") campaignId?: string,
    @Query("q") q?: string,
    @Query("priority") priority?: string,
    @Query("status") status?: string,
    @Query("ownerId") ownerId?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.leadsService.findAll(workspaceId, {
      campaignId, q, priority, status, ownerId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(100, parseInt(limit, 10)) : 50,
    });
  }

  @Get("pipeline")
  @ApiOperation({ summary: "Funil de vendas (Kanban): leads agrupados por status, com totais" })
  @ApiQuery({ name: "ownerId", required: false })
  @ApiQuery({ name: "q", required: false })
  pipeline(@WorkspaceId() workspaceId: string, @Query("ownerId") ownerId?: string, @Query("q") q?: string) {
    return this.leadsService.pipeline(workspaceId, { ownerId, q });
  }

  @Post()
  @ApiOperation({ summary: "Cadastrar lead/negócio manualmente" })
  create(@Body() dto: CreateLeadDto, @WorkspaceId() workspaceId: string, @CurrentUserId() userId: string) {
    return this.leadsService.create(dto, workspaceId, userId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get lead by ID" })
  findOne(@Param("id") id: string, @WorkspaceId() workspaceId: string) {
    return this.leadsService.findOne(id, workspaceId);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Editar dados do lead e do negócio (valor, responsável, previsão)" })
  update(@Param("id") id: string, @Body() dto: UpdateLeadDto, @WorkspaceId() workspaceId: string) {
    return this.leadsService.update(id, dto, workspaceId);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Excluir lead" })
  remove(@Param("id") id: string, @WorkspaceId() workspaceId: string) {
    return this.leadsService.remove(id, workspaceId);
  }

  @Patch(":id/crm")
  @ApiOperation({ summary: "Update CRM status for a lead" })
  updateCrm(@Param("id") id: string, @Body() dto: UpdateCrmDto, @WorkspaceId() workspaceId: string) {
    return this.leadsService.updateCrm(id, dto, workspaceId);
  }
}
