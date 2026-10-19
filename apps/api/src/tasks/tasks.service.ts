import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTaskDto, UpdateTaskDto } from "./dto/task.dto";

const TASK_TYPE_PT: Record<string, string> = {
  call: "Ligar", whatsapp: "WhatsApp", email: "E-mail", meeting: "Reunião", visit: "Visita", other: "Tarefa",
};

export type TaskBucket = "overdue" | "today" | "upcoming" | "open" | "done";

/** Fim do dia de hoje no horário de Brasília (UTC-3, sem horário de verão desde 2019). */
export function endOfTodayBr(now = new Date()) {
  const br = new Date(now.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + 1) + 3 * 3600_000);
}

const whenBr = (d: Date) =>
  d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const LEAD = { select: { id: true, name: true, phone: true, crmStatus: true, ownerId: true, owner: { select: { id: true, name: true } } } };

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  private bucketWhere(bucket: TaskBucket | undefined): Prisma.FollowUpWhereInput {
    const now = new Date();
    const end = endOfTodayBr(now);
    switch (bucket) {
      case "overdue": return { done: false, scheduledAt: { lt: now } };
      case "today": return { done: false, scheduledAt: { gte: now, lt: end } };
      case "upcoming": return { done: false, scheduledAt: { gte: end } };
      case "done": return { done: true };
      case "open": return { done: false };
      default: return {};
    }
  }

  async findAll(workspaceId: string, filter: { status?: TaskBucket; leadId?: string; ownerId?: string }) {
    return this.prisma.followUp.findMany({
      where: {
        lead: { workspaceId, ...(filter.ownerId && { ownerId: filter.ownerId }) },
        ...(filter.leadId && { leadId: filter.leadId }),
        ...this.bucketWhere(filter.status),
      },
      orderBy: filter.status === "done" ? { doneAt: "desc" } : { scheduledAt: "asc" },
      take: 200,
      include: { lead: LEAD },
    });
  }

  async summary(workspaceId: string, ownerId?: string) {
    const lead = { workspaceId, ...(ownerId && { ownerId }) };
    const [overdue, today, upcoming] = await Promise.all(
      (["overdue", "today", "upcoming"] as const).map((b) => this.prisma.followUp.count({ where: { lead, ...this.bucketWhere(b) } })),
    );
    return { overdue, today, upcoming };
  }

  async create(dto: CreateTaskDto, workspaceId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: dto.leadId, workspaceId }, select: { id: true } });
    if (!lead) throw new NotFoundException("Lead não encontrado");
    const scheduledAt = new Date(dto.scheduledAt);
    const type = dto.type ?? "call";
    const [task] = await this.prisma.$transaction([
      this.prisma.followUp.create({ data: { leadId: lead.id, type, note: dto.note.trim(), scheduledAt }, include: { lead: LEAD } }),
      this.prisma.leadActivity.create({
        data: { leadId: lead.id, type: "task_created", note: `${TASK_TYPE_PT[type]} em ${whenBr(scheduledAt)}: ${dto.note.trim()}` },
      }),
    ]);
    return task;
  }

  async update(id: string, dto: UpdateTaskDto, workspaceId: string) {
    const before = await this.findOne(id, workspaceId);
    const task = await this.prisma.followUp.update({
      where: { id },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.note !== undefined && { note: dto.note.trim() }),
        ...(dto.scheduledAt !== undefined && { scheduledAt: new Date(dto.scheduledAt) }),
        ...(dto.done !== undefined && { done: dto.done, doneAt: dto.done ? new Date() : null }),
      },
      include: { lead: LEAD },
    });
    if (dto.done === true && !before.done) {
      await this.prisma.leadActivity.create({
        data: { leadId: task.leadId, type: "task_done", note: `${TASK_TYPE_PT[task.type] ?? "Tarefa"} concluída: ${task.note ?? ""}` },
      });
    }
    return task;
  }

  async remove(id: string, workspaceId: string) {
    await this.findOne(id, workspaceId);
    await this.prisma.followUp.delete({ where: { id } });
    return { ok: true };
  }

  private async findOne(id: string, workspaceId: string) {
    const task = await this.prisma.followUp.findFirst({ where: { id, lead: { workspaceId } } });
    if (!task) throw new NotFoundException("Tarefa não encontrada");
    return task;
  }
}
