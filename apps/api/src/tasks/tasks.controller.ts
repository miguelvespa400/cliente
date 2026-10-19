import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from "@nestjs/swagger";
import { TasksService, type TaskBucket } from "./tasks.service";
import { CreateTaskDto, UpdateTaskDto } from "./dto/task.dto";
import { JwtGuard } from "../auth/jwt.guard";
import { WorkspaceId } from "../auth/current-workspace.decorator";

@ApiTags("Tasks")
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ summary: "Listar tarefas do CRM" })
  @ApiQuery({ name: "status", required: false, enum: ["overdue", "today", "upcoming", "open", "done"] })
  @ApiQuery({ name: "leadId", required: false })
  @ApiQuery({ name: "ownerId", required: false, description: "Responsável pelo lead" })
  findAll(
    @WorkspaceId() workspaceId: string,
    @Query("status") status?: TaskBucket,
    @Query("leadId") leadId?: string,
    @Query("ownerId") ownerId?: string,
  ) {
    return this.tasks.findAll(workspaceId, { status, leadId, ownerId });
  }

  @Get("summary")
  @ApiOperation({ summary: "Contagem de tarefas atrasadas, de hoje e próximas (lembretes)" })
  @ApiQuery({ name: "ownerId", required: false })
  summary(@WorkspaceId() workspaceId: string, @Query("ownerId") ownerId?: string) {
    return this.tasks.summary(workspaceId, ownerId);
  }

  @Post()
  @ApiOperation({ summary: "Agendar tarefa para um lead" })
  create(@Body() dto: CreateTaskDto, @WorkspaceId() workspaceId: string) {
    return this.tasks.create(dto, workspaceId);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Editar ou concluir tarefa" })
  update(@Param("id") id: string, @Body() dto: UpdateTaskDto, @WorkspaceId() workspaceId: string) {
    return this.tasks.update(id, dto, workspaceId);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Excluir tarefa" })
  remove(@Param("id") id: string, @WorkspaceId() workspaceId: string) {
    return this.tasks.remove(id, workspaceId);
  }
}
