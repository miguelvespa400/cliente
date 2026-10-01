import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ScrapedBusiness } from "./google-maps.scraper";

// Cliente da API REST do gosom/google-maps-scraper rodando em modo web (-web).
// Fluxo: cria um job com todas as buscas, acompanha o status e baixa o CSV de resultados.
// Docs: https://github.com/gosom/google-maps-scraper#rest-api

const LANG_CODES: Record<string, string> = {
  portuguese: "pt",
  english: "en",
  spanish: "es",
  indonesian: "id",
};

// Links que aparecem no campo "website" mas não são um site próprio da empresa.
const SOCIAL_HOSTS = /(^|\.)(instagram\.com|facebook\.com|fb\.com|wa\.me|whatsapp\.com|linktr\.ee|bio\.site|tiktok\.com|linkedin\.com|youtube\.com|twitter\.com|x\.com)$/i;

const NS_PER_SECOND = 1_000_000_000;
const POLL_INTERVAL_MS = 5000;

interface GosomJob {
  ID: string;
  Status: "pending" | "working" | "ok" | "failed";
}

export interface GosomScrapeOptions {
  language: string;
  maxResults: number;
  onProgress?: (fraction: number) => Promise<void>;
}

@Injectable()
export class GosomScraperService {
  private readonly logger = new Logger(GosomScraperService.name);

  constructor(private config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>("GOSOM_URL", "http://localhost:8080").replace(/\/$/, "");
  }

  async scrape(queries: string[], opts: GosomScrapeOptions): Promise<ScrapedBusiness[]> {
    const maxTimeSec = this.config.get<number>("GOSOM_MAX_TIME_SECONDS", 900);
    const extractEmails = this.config.get<string>("GOSOM_EXTRACT_EMAILS", "true") === "true";
    // Cada nível de "depth" rola a lista do Maps uma vez (~20 resultados).
    const depth = Math.max(1, Math.ceil(opts.maxResults / 20));

    const id = await this.createJob({
      name: `prospex-${Date.now()}`,
      keywords: queries,
      lang: LANG_CODES[opts.language] ?? "pt",
      zoom: 15,
      depth,
      email: extractEmails,
      max_time: maxTimeSec * NS_PER_SECOND,
    });
    this.logger.log(`gosom job ${id}: ${queries.length} buscas, depth ${depth}, emails=${extractEmails}`);

    try {
      await this.waitForJob(id, maxTimeSec * 1000 + 60_000, opts.onProgress);
      const csv = await this.request(`/api/v1/jobs/${id}/download`).then((r) => r.text());
      return this.parseResults(csv);
    } finally {
      await this.request(`/api/v1/jobs/${id}`, { method: "DELETE" }).catch(() => undefined);
    }
  }

  private async createJob(body: Record<string, unknown>): Promise<string> {
    const res = await this.request("/api/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const { id } = (await res.json()) as { id: string };
    return id;
  }

  private async waitForJob(id: string, timeoutMs: number, onProgress?: (f: number) => Promise<void>) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const job = (await this.request(`/api/v1/jobs/${id}`).then((r) => r.json())) as GosomJob;
      if (job.Status === "ok") return;
      if (job.Status === "failed") throw new Error(`gosom job ${id} falhou`);
      // Sem progresso real na API: avança de forma assintótica para a barra não travar.
      await onProgress?.(1 - Math.exp(-(Date.now() - started) / 120_000));
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`gosom job ${id} excedeu o tempo limite`);
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new Error(`Não foi possível conectar ao gosom em ${this.baseUrl} — ele está rodando? (${err})`);
    }
    if (!res.ok) throw new Error(`gosom ${init?.method ?? "GET"} ${path}: HTTP ${res.status}`);
    return res;
  }

  private parseResults(csv: string): ScrapedBusiness[] {
    const [header, ...rows] = parseCsv(csv);
    if (!header) return [];
    const col = (row: string[], name: string) => row[header.indexOf(name)]?.trim() ?? "";

    return rows
      .filter((row) => col(row, "title"))
      .map((row) => {
        const website = col(row, "website");
        const rating = parseFloat(col(row, "review_rating"));
        const reviewCount = parseInt(col(row, "review_count"), 10);
        const lat = parseFloat(col(row, "latitude"));
        const lng = parseFloat(col(row, "longitude"));
        return {
          name: col(row, "title"),
          address: col(row, "address"),
          phone: col(row, "phone"),
          website,
          rating: Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : "N/A",
          reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
          hasWebsite: isOwnWebsite(website),
          referenceLink: col(row, "link"),
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
          source: "Google Maps (gosom)",
          email: firstEmail(col(row, "emails")),
          category: col(row, "category"),
        };
      });
  }
}

function isOwnWebsite(url: string): boolean {
  if (!url) return false;
  try {
    return !SOCIAL_HOSTS.test(new URL(url.startsWith("http") ? url : `https://${url}`).hostname);
  } catch {
    return false;
  }
}

// O campo "emails" vem como lista ("[a@b.com c@d.com]", JSON ou separada por vírgula).
function firstEmail(raw: string): string {
  return raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
}

// Parser CSV (RFC 4180): campos entre aspas podem conter vírgulas, aspas duplas e quebras de linha.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
