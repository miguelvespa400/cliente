import { Injectable, Logger } from "@nestjs/common";
import { lookup as dnsLookup, type LookupAddress } from "dns";
import { BlockList, isIP } from "net";
import * as http from "http";
import * as https from "https";

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
// Faixas que nunca são "site de empresa": rede interna, loopback, metadados da nuvem etc.
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["2001:db8::", 32]] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

function isBlockedIp(address: string): boolean {
  // IPv4 embutido em IPv6 (::ffff:10.0.0.1) é avaliado como IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return BLOCKED.check(mapped, "ipv4");
  const family = isIP(address);
  return family === 0 || BLOCKED.check(address, family === 6 ? "ipv6" : "ipv4");
}

// O IP é validado DENTRO da conexão (lookup do socket), não antes: assim um DNS que responde
// um IP público na checagem e um interno na conexão (DNS rebinding) não passa.
function safeLookup(
  hostname: string,
  options: { all?: boolean },
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedIp(a.address))) {
      return callback(Object.assign(new Error(`Destino bloqueado: ${hostname}`), { code: "EBLOCKED" }), "");
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

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

  /** GET com o IP validado na conexão; só http/https nas portas padrão. */
  private request(url: URL): Promise<{ status: number; location: string | null; contentType: string; body: string }> {
    return new Promise((resolve, reject) => {
      if (!["http:", "https:"].includes(url.protocol)) return reject(new Error("Protocolo bloqueado"));
      if (url.port && !["80", "443"].includes(url.port)) return reject(new Error("Porta bloqueada"));
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (isIP(host) && isBlockedIp(host)) return reject(new Error("IP bloqueado"));

      const lib = url.protocol === "https:" ? https : http;
      const req = lib.get(
        url,
        {
          lookup: safeLookup as unknown as typeof dnsLookup,
          timeout: TIMEOUT_MS,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; WishLeadBot/1.0)", Accept: "text/html" },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const contentType = String(res.headers["content-type"] ?? "");
          const location = status >= 300 && status < 400 ? (res.headers.location ?? null) : null;
          if (location || status >= 400 || !contentType.includes("html")) {
            res.resume();
            return resolve({ status, location, contentType, body: "" });
          }
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
            if (body.length > MAX_HTML) res.destroy();
          });
          res.on("close", () => resolve({ status, location, contentType, body: body.slice(0, MAX_HTML) }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
    });
  }

  private async fetchHtml(url: string): Promise<string | null> {
    try {
      let current = new URL(url);
      // Redirecionamento manual (máx. 3): cada salto passa de novo pelas mesmas travas.
      for (let hop = 0; hop <= 3; hop++) {
        const res = await this.request(current);
        if (!res.location) return res.status >= 200 && res.status < 300 ? res.body : "";
        current = new URL(res.location, current);
      }
      return "";
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
