import { Injectable, ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  // Em produção (REGISTRATION_OPEN=false) só entra o primeiro usuário (vira dono) e
  // os e-mails convidados em REGISTRATION_ALLOWED_EMAILS — evita que estranhos usem o
  // servidor e os créditos de IA pelo endereço público.
  private async assertRegistrationAllowed(email: string) {
    if (this.config.get<string>("REGISTRATION_OPEN", "true") === "true") return;
    if ((await this.prisma.user.count()) === 0) return;
    const allowed = this.config
      .get<string>("REGISTRATION_ALLOWED_EMAILS", "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.includes(email.trim().toLowerCase())) return;
    throw new ForbiddenException("Cadastro fechado. Peça um convite ao administrador do sistema.");
  }

  async register(dto: RegisterDto) {
    await this.assertRegistrationAllowed(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException("Este e-mail já está cadastrado");

    const hashed = await bcrypt.hash(dto.password, 12);
    const slug = dto.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const uniqueSlug = `${slug}-${Date.now().toString(36)}`;

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        accounts: {
          create: {
            accountId: dto.email,
            providerId: "credential",
            password: hashed,
          },
        },
        memberships: {
          create: {
            role: "owner",
            workspace: {
              create: {
                name: dto.workspaceName,
                slug: uniqueSlug,
              },
            },
          },
        },
      },
      include: { memberships: { include: { workspace: true } } },
    });

    const workspace = user.memberships[0].workspace;
    const token = this.jwt.sign({ sub: user.id, workspaceId: workspace.id, email: user.email });

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        accounts: { where: { providerId: "credential" } },
        memberships: { include: { workspace: true }, take: 1 },
      },
    });

    if (!user || !user.accounts[0]?.password) {
      throw new UnauthorizedException("E-mail ou senha inválidos");
    }

    const valid = await bcrypt.compare(dto.password, user.accounts[0].password);
    if (!valid) throw new UnauthorizedException("E-mail ou senha inválidos");

    const workspace = user.memberships[0]?.workspace;
    const token = this.jwt.sign({
      sub: user.id,
      workspaceId: workspace?.id ?? "default-workspace",
      email: user.email,
    });

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
      workspace: workspace
        ? { id: workspace.id, name: workspace.name, slug: workspace.slug }
        : null,
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { workspace: true }, take: 1 } },
    });
    if (!user) throw new UnauthorizedException();
    const workspace = user.memberships[0]?.workspace;
    return {
      user: { id: user.id, name: user.name, email: user.email },
      workspace: workspace
        ? { id: workspace.id, name: workspace.name, slug: workspace.slug }
        : null,
    };
  }
}
