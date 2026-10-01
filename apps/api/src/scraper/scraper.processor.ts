import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { CampaignsService } from "../campaigns/campaigns.service";
import { LeadsService } from "../leads/leads.service";
import { LeadIntelligenceService } from "../ai/lead-intelligence.service";
import { MarketingAiService } from "../ai/marketing-ai.service";
import { GoogleMapsScraperService, type ScrapedBusiness } from "./google-maps.scraper";
import { GosomScraperService } from "./gosom.scraper";

export interface ScraperJobData {
  campaignId: string;
  workspaceId: string;
  searchQueries: string[];
  industry: string;
  location: string;
  maxResults: number;
  yourService: string;
  contentStyle: string;
  language: string;
}

@Processor("scraper")
@Injectable()
export class ScraperProcessor extends WorkerHost {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(
    private campaigns: CampaignsService,
    private leads: LeadsService,
    private leadIntelligence: LeadIntelligenceService,
    private marketingAi: MarketingAiService,
    private googleMaps: GoogleMapsScraperService,
    private gosom: GosomScraperService,
    private config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<ScraperJobData>): Promise<void> {
    const data = job.data;
    const { campaignId, workspaceId } = data;
    this.logger.log(`Starting campaign ${campaignId} (job ${job.id})`);

    try {
      await this.campaigns.updateStatus(campaignId, "running", 0);

      const rawLeads = await this.scrapeLeads(data, campaignId);
      const total = rawLeads.length;

      if (total === 0) {
        await this.campaigns.updateStatus(campaignId, "failed", 0, "No leads found");
        return;
      }

      await this.campaigns.updateStatus(campaignId, "running", 30);

      const scoredLeads = this.leadIntelligence.scoreLeads(rawLeads, data.industry);
      await this.campaigns.updateStatus(campaignId, "running", 60);

      const processedLeads = await Promise.all(
        scoredLeads.map(async (lead, i) => {
          let marketingContent = null;
          if (lead.priority === "HIGH") {
            try {
              marketingContent = await this.marketingAi.generateContent({
                businessName: lead.name,
                address: lead.address,
                industry: data.industry,
                rating: lead.rating,
                hasWebsite: lead.hasWebsite,
                yourService: data.yourService,
                contentStyle: data.contentStyle,
                language: data.language,
                score: lead.score,
              });
            } catch (e) {
              this.logger.warn(`Content gen failed for ${lead.name}: ${e}`);
            }
          }
          if (i % 5 === 0) {
            const pct = 60 + Math.round((i / total) * 35);
            await this.campaigns.updateStatus(campaignId, "running", pct);
          }
          return {
            name: lead.name,
            address: lead.address,
            phone: lead.phone,
            email: lead.email || undefined,
            category: lead.mapsCategory || undefined,
            source: lead.source,
            website: lead.website,
            rating: lead.rating,
            reviewCount: lead.reviewCount ?? undefined,
            hasWebsite: lead.hasWebsite ?? false,
            referenceUrl: lead.referenceUrl,
            lat: lead.lat ?? undefined,
            lng: lead.lng ?? undefined,
            score: lead.score,
            priority: lead.priority,
            aiAnalysis: { factors: lead.factors, recommendation: lead.recommendation },
            marketingContent,
            campaignId,
            workspaceId,
          };
        }),
      );

      await this.leads.createMany(processedLeads);

      const highQuality = processedLeads.filter((l) => (l.score ?? 0) >= 70).length;
      const priority = processedLeads.filter((l) => l.priority === "HIGH").length;
      const avgScore = Math.round(
        processedLeads.reduce((s, l) => s + (l.score ?? 0), 0) / processedLeads.length,
      );

      await this.campaigns.updateStats(campaignId, {
        totalLeads: total,
        priorityLeads: priority,
        highQualityLeads: highQuality,
        averageScore: avgScore,
      });

      await this.campaigns.updateStatus(campaignId, "completed", 100);
      this.logger.log(`Campaign ${campaignId} done: ${total} leads, ${priority} priority`);
    } catch (err) {
      this.logger.error(`Campaign ${campaignId} failed: ${err}`);
      await this.campaigns.updateStatus(campaignId, "failed", undefined, String(err));
      throw err; // re-throw so BullMQ can retry if configured
    }
  }

  private async scrapeLeads(data: ScraperJobData, campaignId: string) {
    // Não usamos split(",") na localização: "Curitiba, PR" é uma cidade só, não duas áreas.
    const area = data.location.trim();
    const combos = data.searchQueries
      .map((q) => q.trim())
      .filter(Boolean)
      .map((query) => ({
        query: area && !query.toLowerCase().includes(area.split(",")[0].trim().toLowerCase())
          ? `${query} ${area}`
          : query,
        area,
      }));
    if (combos.length === 0) combos.push({ query: `${data.industry} ${area}`.trim(), area });

    const results =
      this.config.get<string>("SCRAPER_PROVIDER", "gosom") === "gosom"
        ? await this.scrapeWithGosom(data, campaignId, combos)
        : await this.scrapeWithPlaywright(data, campaignId, combos);

    // Deduplicate by name+address
    const seen = new Set<string>();
    return results
      .filter((b) => {
        const key = `${b.name.toLowerCase()}|${b.address.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, data.maxResults);
  }

  private async scrapeWithGosom(
    data: ScraperJobData,
    campaignId: string,
    combos: { query: string; area: string }[],
  ) {
    try {
      const raw = await this.gosom.scrape(
        combos.map((c) => c.query),
        {
          language: data.language,
          maxResults: Math.ceil(data.maxResults / combos.length),
          onProgress: async (f) => {
            await this.campaigns.updateStatus(campaignId, "running", Math.round(f * 28));
          },
        },
      );
      this.logger.log(`gosom: ${raw.length} resultados para ${combos.length} buscas`);
      return raw.map((b) => this.normalizeRaw(b, data.industry));
    } catch (err) {
      return this.handleScrapeFailure(data, combos, err);
    }
  }

  private async scrapeWithPlaywright(
    data: ScraperJobData,
    campaignId: string,
    combos: { query: string; area: string }[],
  ) {
    const perQuery = Math.ceil(data.maxResults / combos.length);
    const results: ReturnType<typeof this.normalizeRaw>[] = [];

    for (let i = 0; i < combos.length; i++) {
      const combo = combos[i];
      try {
        const raw = await this.googleMaps.scrape(combo.query, perQuery);
        results.push(...raw.map((b) => this.normalizeRaw(b, data.industry)));
        this.logger.log(`Query "${combo.query}": ${raw.length} results`);
      } catch (err) {
        results.push(...this.handleScrapeFailure(data, [combo], err));
      }
      const pct = Math.round(((i + 1) / combos.length) * 28);
      await this.campaigns.updateStatus(campaignId, "running", pct);
    }
    return results;
  }

  // Leads fictícios só com SCRAPER_MOCK_FALLBACK=true (dev/CI). Em uso real, a falha
  // precisa aparecer na campanha — prospectar empresas inventadas é pior que não ter leads.
  private handleScrapeFailure(
    data: ScraperJobData,
    combos: { query: string; area: string }[],
    err: unknown,
  ) {
    if (this.config.get<string>("SCRAPER_MOCK_FALLBACK", "false") !== "true") {
      throw new Error(`Falha na coleta do Google Maps: ${err instanceof Error ? err.message : err}`);
    }
    this.logger.warn(`Scrape failed, using mock fallback: ${err}`);
    const perQuery = Math.ceil(data.maxResults / combos.length);
    return combos.flatMap((c) => this.generateMockLeads(data, c.query, c.area, perQuery));
  }

  private normalizeRaw(raw: ScrapedBusiness, industry: string) {
    return {
      name: raw.name,
      address: raw.address,
      phone: raw.phone ?? "",
      website: raw.website ?? "",
      rating: raw.rating ?? "N/A",
      reviewCount: raw.reviewCount ?? null,
      hasWebsite: raw.hasWebsite ?? !!raw.website,
      referenceUrl: raw.referenceLink ?? "",
      lat: raw.lat ?? null,
      lng: raw.lng ?? null,
      email: raw.email ?? "",
      mapsCategory: raw.category ?? "",
      source: raw.source?.startsWith("Google Maps") ? "google_maps" : "mock",
      industry,
    };
  }

  private generateMockLeads(data: ScraperJobData, query: string, area: string, count: number) {
    const label = query || data.industry;
    const prefixes = [
      `${label} Premier`, `Toko ${label} Jaya`, `${label} Makmur`,
      `Usaha ${label} Sejahtera`, `${label} Berkah`, `${label} Mandiri`,
      `${label} Maju`, `${label} Bersama`, `${label} Sukses`, `${label} Abadi`,
    ];
    return Array.from({ length: Math.min(count, prefixes.length) }, (_, i) => ({
      name: prefixes[i],
      address: `Jl. ${area} No. ${10 + i}, ${area}`,
      phone: `+628${String(10000000 + i * 1234567)}`,
      website: i % 3 !== 0 ? `www.${label.toLowerCase().replace(/\s+/g, "")}${i + 1}.com` : "",
      rating: ((3.5 + (i % 3) * 0.4)).toFixed(1),
      reviewCount: 5 + i * 17,
      hasWebsite: i % 3 !== 0,
      referenceUrl: "",
      lat: null,
      lng: null,
      email: "",
      mapsCategory: "",
      source: "mock",
      industry: data.industry,
    }));
  }
}
