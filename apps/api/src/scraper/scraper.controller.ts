import { Controller, Post, Param, HttpCode, HttpStatus, UseGuards, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { CampaignsService } from "../campaigns/campaigns.service";
import { JwtGuard } from "../auth/jwt.guard";
import { WorkspaceId } from "../auth/current-workspace.decorator";
import { ScraperJobData } from "./scraper.processor";
import { EmailFinderService } from "./email-finder.service";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("Scraper")
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller("scraper")
export class ScraperController {
  private readonly logger = new Logger(ScraperController.name);

  constructor(
    @InjectQueue("scraper") private readonly scraperQueue: Queue<ScraperJobData>,
    private readonly campaigns: CampaignsService,
    private readonly emailFinder: EmailFinderService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("campaigns/:id/find-emails")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Procura e-mail no site dos leads da campanha que ainda não têm (roda em segundo plano)" })
  async findEmails(@Param("id") id: string, @WorkspaceId() workspaceId: string) {
    await this.campaigns.findOne(id, workspaceId);
    const leads = await this.prisma.lead.findMany({
      where: { campaignId: id, workspaceId, OR: [{ email: null }, { email: "" }], NOT: [{ website: null }, { website: "" }] },
      select: { id: true, website: true },
    });
    // Pode levar minutos (vários sites lentos): responde já e grava conforme acha.
    void this.emailFinder.findMany(leads.map((l) => l.website)).then(async (emails) => {
      const updates = leads
        .map((l, i) => ({ id: l.id, email: emails[i] }))
        .filter((u): u is { id: string; email: string } => !!u.email);
      for (const u of updates) await this.prisma.lead.update({ where: { id: u.id }, data: { email: u.email } });
      this.logger.log(`Campaign ${id}: ${updates.length}/${leads.length} e-mails encontrados nos sites`);
    }).catch((e) => this.logger.error(`find-emails ${id} failed: ${e}`));
    return { checking: leads.length };
  }

  @Post("campaigns/:id/start")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Start campaign scraping job" })
  async startCampaign(
    @Param("id") id: string,
    @WorkspaceId() workspaceId: string,
  ) {
    const campaign = await this.campaigns.findOne(id, workspaceId);
    const job = await this.scraperQueue.add(
      "scrape",
      {
        campaignId: campaign.id,
        campaignName: campaign.name,
        workspaceId: campaign.workspaceId,
        searchQueries: campaign.searchQueries,
        industry: campaign.industry,
        location: campaign.location,
        maxResults: campaign.maxResults,
        yourService: campaign.yourService,
        contentStyle: campaign.contentStyle,
        language: campaign.language,
      },
      {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    return { message: "Campaign queued", campaignId: id, jobId: job.id };
  }
}
