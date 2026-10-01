import { Injectable, NotFoundException, ConflictException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WorkspaceService {
  constructor(private prisma: PrismaService) {}

  async getWorkspace(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException("Workspace não encontrado");
    return workspace;
  }

  async updateWorkspace(
    workspaceId: string,
    data: { name?: string; slug?: string },
    requesterId: string,
  ) {
    await this.requireOwnerOrAdmin(workspaceId, requesterId);

    if (data.slug) {
      const existing = await this.prisma.workspace.findUnique({ where: { slug: data.slug } });
      if (existing && existing.id !== workspaceId) {
        throw new ConflictException("Este identificador (slug) já está em uso");
      }
    }

    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.slug ? { slug: data.slug } : {}),
      },
    });
  }

  async getMembers(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async inviteMember(workspaceId: string, email: string, role: string, requesterId: string) {
    await this.requireOwnerOrAdmin(workspaceId, requesterId);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException(`Nenhum usuário encontrado com o e-mail ${email}`);

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    });
    if (existing) throw new ConflictException("Este usuário já é membro deste workspace");

    return this.prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role: role || "member" },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  async updateMemberRole(workspaceId: string, memberId: string, role: string, requesterId: string) {
    await this.requireOwnerOrAdmin(workspaceId, requesterId);

    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!member) throw new NotFoundException("Membro não encontrado");
    if (member.role === "owner") throw new ForbiddenException("Não é possível alterar a função do proprietário");

    return this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  async removeMember(workspaceId: string, memberId: string, requesterId: string) {
    await this.requireOwnerOrAdmin(workspaceId, requesterId);

    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!member) throw new NotFoundException("Membro não encontrado");
    if (member.role === "owner") throw new ForbiddenException("Não é possível remover o proprietário do workspace");

    return this.prisma.workspaceMember.delete({ where: { id: memberId } });
  }

  private async requireOwnerOrAdmin(workspaceId: string, userId: string) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new ForbiddenException("Apenas proprietários e administradores podem gerenciar membros");
    }
  }
}
