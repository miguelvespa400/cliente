import { Injectable, Logger } from "@nestjs/common";
import { lookup } from "dns/promises";
import { isIP } from "net";

// Busca um e-mail de contato no site da empresa (página inicial + páginas de contato).
// O Google Maps quase nunca mostra e-mail; o site costuma ter um contato@/comercial@.

const CONTACT_PATHS = ["", "/contato", "/contatos", "/fale-conosco", "/contact", "/contact-us"];
const TIMEOUT_MS = 8000;
const MAX_HTML = 1_500_000;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Domínios de plataformas/bibliotecas que aparecem no HTML mas não são da empresa.
const IGNORED_DOMAINS = [
  "sentry.io", "sentry-next.wixpress.com", "wixpress.com", "wix.com", "example.com", "exemplo.com",
  "domain.com", "dominio.com", "email.com", "seuemail.com", "godaddy.com", "googleapis.com",
  "schema.org", "w3.org", "sentry.wixpress.com", "cloudflare.com",
];
const PRIVATE_IP = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/, /^::$/, /^f[cd][0-9a-f]{2}:/i, /^fe[89ab][0-9a-f]:/i, /^::ffff:(127|10|192\.168|169\.254)\./i,
];
const IGNORED_EXT = /\.(png|jpe?g|gif|svg|webp|css|js|ico)$/i;
// Prefixos de contato comercial vêm primeiro na escolha.
const PREFERRED = ["contato", "comercial", "vendas", "atendimento", "faleconosco", "sac", "info", "adm", "administrativo"];

@Injectable()
export class EmailFinderService {
  private readonly logger = new Logger(EmailFinderService.name);

  async findEmail(website: string | null | undefined): Promise<string | null> {
    const base = this.normalizeBase(website);
    if (!base) return null;
    const siteHost = base.hostname.replace(/^www\./, "");
    const found = new Set<string>();

    for (const path of CONTACT_PATHS) {
      const html = await this.fetchHtml(new URL(path || "/", base).toString());
      if (html === null && path === "") return null; // site fora do ar: não insiste
      if (!html) continue;
      for (const email of this.extract(html)) found.add(email);
      // E-mail do próprio domínio é o melhor sinal possível: para aqui.
      if ([...found].some((e) => e.endsWith(`@${siteHost}`))) break;
    }
    return this.pick([...found], siteHost);
  }

  /** Roda em paralelo com limite, para não abrir dezenas de conexões de uma vez. */
  async findMany(websites: (string | null | undefined)[], concurrency = 5): Promise<(string | null)[]> {
    const results: (string | null)[] = new Array(websites.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < websites.length) {
        const i = next++;
        try {
          results[i] = await this.findEmail(websites[i]);
        } catch (e) {
          this.logger.debug(`Email lookup failed for ${websites[i]}: ${e}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, websites.length) }, worker));
    return results;
  }

  private normalizeBase(website: string | null | undefined): URL | null {
    const raw = (website ?? "").trim();
    if (!raw) return null;
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      // Redes sociais e agregadores não têm o e-mail da empresa no HTML.
      if (/(facebook|instagram|linktr\.ee|wa\.me|whatsapp|google)\./i.test(url.hostname)) return null;
      return new URL(url.origin);
    } catch {
      return null;
    }
  }

  /** Bloqueia SSRF: o "site" vem do Google Maps (dado externo) e pode apontar para a rede interna. */
  private async isPublicUrl(url: URL): Promise<boolean> {
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (url.port && !["80", "443"].includes(url.port)) return false;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (addrs.length === 0) return false;
    return addrs.every(({ address }) => !PRIVATE_IP.some((re) => re.test(address)));
  }

  private async fetchHtml(url: string): Promise<string | null> {
    try {
      let current = new URL(url);
      let res: Response | null = null;
      // Redirecionamento manual para revalidar o destino a cada salto.
      for (let hop = 0; hop <= 3; hop++) {
        if (!(await this.isPublicUrl(current))) return null;
        res = await fetch(current, {
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ProspexBot/1.0)", Accept: "text/html" },
        });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
        if (!location) break;
        current = new URL(location, current);
        res = null;
      }
      if (!res) return "";
      if (!res.ok) return "";
      if (!(res.headers.get("content-type") ?? "").includes("html")) return "";
      return (await res.text()).slice(0, MAX_HTML);
    } catch {
      return null;
    }
  }

  private extract(html: string): string[] {
    // mailto: primeiro (é intencional); depois qualquer e-mail no texto.
    const decoded = html.replace(/&#64;|%40|\[at\]|\(at\)/gi, "@");
    const matches = decoded.match(EMAIL_RE) ?? [];
    return matches
      .map((e) => e.toLowerCase().replace(/^mailto:/, "").replace(/\.+$/, ""))
      .filter((e) => !IGNORED_EXT.test(e))
      .filter((e) => !IGNORED_DOMAINS.some((d) => e.endsWith(`@${d}`) || e.endsWith(`.${d}`)))
      .filter((e) => e.length <= 80);
  }

  private pick(emails: string[], siteHost: string): string | null {
    if (emails.length === 0) return null;
    const score = (e: string) => {
      const [local, domain] = e.split("@");
      let s = 0;
      if (domain === siteHost || domain.endsWith(`.${siteHost}`)) s += 10;
      const pref = PREFERRED.findIndex((p) => local.startsWith(p));
      if (pref >= 0) s += 5 - pref * 0.1;
      if (/noreply|no-reply|naoresponda/.test(local)) s -= 20;
      return s;
    };
    return [...emails].sort((a, b) => score(b) - score(a))[0];
  }
}
