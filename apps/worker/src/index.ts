// Prospex no Cloudflare Workers + D1. Reproduz a API REST de apps/api (NestJS) que o painel
// (apps/web) usa, com as mesmas rotas e formatos de resposta. Diferenças:
//  - busca de empresas pela API oficial do Google Places (chave cadastrada em Integrações),
//    pois o coletor por navegador (Playwright) não roda no Workers;
//  - campanha processada em ctx.waitUntil (sem fila Redis/BullMQ);
//  - mensagens da IA geradas quando o lead é aberto (economiza IA e cabe no limite de tempo).
import { Hono, type Context } from "hono";
import {
  decryptSecret, encryptSecret, hashPassword, newId, randomToken, sha256Hex, signJwt, verifyJwt, verifyPassword,
} from "./lib/crypto";
import { scoreLead } from "./lib/scoring";
import { generateContent, type AiConfig } from "./lib/ai";
import { searchPlaces, testPlacesKey } from "./lib/places";
import {
  graph, sendTelegram, sendWebhook, sendWhatsApp, telegramText, UserError, wants, type ProspexEvent,
} from "./lib/outbound";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  REGISTRATION_ALLOWED_EMAILS?: string;
  /** URL pública do painel, usada nos links do resumo diário (cron não tem requisição de origem). */
  APP_URL?: string;
}
type Vars = { userId: string; workspaceId: string };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath("/api");

const now = () => new Date().toISOString();
const SECRET_KEYS = ["apiKey", "botToken", "secret", "accessToken"];
const MASK = "••••••••";
const CRM_PT: Record<string, string> = {
  new: "Novo", contacted: "Contatado", replied: "Respondeu", meeting: "Reunião", proposal: "Proposta", won: "Ganho", lost: "Perdido",
};
const PRIORITY_PT: Record<string, string> = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const bad = (msg: string) => new HttpError(400, msg);
const notFound = (msg: string) => new HttpError(404, msg);

app.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : err instanceof UserError ? 400 : 500;
  if (status === 500) console.error(err);
  const message = status === 500 ? "Erro interno do servidor. Tente novamente em instantes" : err.message;
  return c.json({ statusCode: status, message, timestamp: now(), path: new URL(c.req.url).pathname }, status as 400);
});

const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || !v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};

async function body<T>(c: Ctx): Promise<T> {
  try { return (await c.req.json()) as T; } catch { throw bad("Corpo da requisição inválido"); }
}

// ── Mapeamento banco (snake_case) → API (camelCase, igual ao Prisma) ─────────
type Row = Record<string, unknown>;

function campaignOut(r: Row) {
  return {
    id: r.id, name: r.name, description: r.description ?? null, industry: r.industry, location: r.location,
    searchQueries: parse<string[]>(r.search_queries, []), maxResults: r.max_results, yourService: r.your_service,
    contentStyle: r.content_style, language: r.language, status: r.status, progress: r.progress, error: r.error ?? null,
    startedAt: r.started_at ?? null, completedAt: r.completed_at ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
    totalLeads: r.total_leads, priorityLeads: r.priority_leads, highQualityLeads: r.high_quality_leads,
    averageScore: r.average_score, workspaceId: r.workspace_id, _count: { leads: Number(r.lead_count ?? r.total_leads ?? 0) },
  };
}

function leadOut(r: Row) {
  return {
    id: r.id, name: r.name, address: r.address ?? "", lat: r.lat ?? null, lng: r.lng ?? null, phone: r.phone ?? "",
    email: r.email ?? null, website: r.website ?? "", rating: r.rating ?? "N/A", reviewCount: r.review_count ?? null,
    category: r.category ?? null, source: r.source, referenceUrl: r.reference_url ?? "", hasWebsite: !!r.has_website,
    score: r.score, priority: r.priority, aiAnalysis: parse(r.ai_analysis, null), marketingContent: parse(r.marketing_content, null),
    crmStatus: r.crm_status, crmNotes: r.crm_notes ?? null, scrapedAt: r.scraped_at, createdAt: r.created_at, updatedAt: r.updated_at,
    contactName: r.contact_name ?? null, dealValue: r.deal_value ?? null, expectedCloseDate: r.expected_close_date ?? null,
    ownerId: r.owner_id ?? null, owner: r.owner_id ? { id: r.owner_id, name: r.owner_name ?? "" } : null,
    workspaceId: r.workspace_id, campaignId: r.campaign_id ?? null,
    campaign: r.campaign_id ? { id: r.campaign_id, name: r.campaign_name ?? "" } : null,
  };
}

function taskOut(r: Row) {
  return {
    id: r.id, leadId: r.lead_id, type: r.type, note: r.note, scheduledAt: r.scheduled_at, done: !!r.done,
    doneAt: r.done_at ?? null, createdAt: r.created_at,
    lead: {
      id: r.lead_id, name: r.lead_name ?? "", phone: r.lead_phone ?? null, crmStatus: r.lead_status ?? null,
      ownerId: r.lead_owner_id ?? null, owner: r.lead_owner_id ? { id: r.lead_owner_id, name: r.lead_owner_name ?? "" } : null,
    },
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TASK_TYPES: Record<string, string> = {
  call: "Ligar", whatsapp: "WhatsApp", email: "E-mail", meeting: "Reunião", visit: "Visita", other: "Tarefa",
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const whenBr = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Fim do dia de hoje no horário de Brasília (UTC-3, sem horário de verão desde 2019). */
function endOfTodayBr(at = new Date()) {
  const br = new Date(at.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + 1) + 3 * 3600_000);
}

// ── Integrações (config com segredos criptografados) ─────────────────────────
async function getIntegration(env: Env, workspaceId: string, type: string): Promise<Record<string, string> | null> {
  const row = await env.DB.prepare("SELECT config FROM integrations WHERE workspace_id = ? AND type = ? AND enabled = 1")
    .bind(workspaceId, type).first<{ config: string }>();
  if (!row) return null;
  const cfg = parse<Record<string, string>>(row.config, {});
  for (const k of SECRET_KEYS) if (cfg[k]) cfg[k] = await decryptSecret(cfg[k], env.ENCRYPTION_KEY);
  return cfg;
}

async function aiConfig(env: Env, workspaceId: string): Promise<AiConfig | null> {
  const cfg = await getIntegration(env, workspaceId, "openai");
  return cfg?.apiKey ? { apiKey: cfg.apiKey, model: cfg.model || undefined, baseURL: cfg.baseURL || undefined } : null;
}

async function emit(env: Env, appUrl: string, workspaceId: string, event: ProspexEvent, data: Record<string, unknown>) {
  const [webhook, telegram] = await Promise.all([
    getIntegration(env, workspaceId, "webhook").catch(() => null),
    getIntegration(env, workspaceId, "telegram").catch(() => null),
  ]);
  const jobs = [];
  if (webhook?.url && wants(webhook.events, event)) jobs.push(sendWebhook(webhook, event, workspaceId, data));
  if (telegram?.botToken && telegram.chatId && wants(telegram.events, event)) {
    jobs.push(sendTelegram(telegram, telegramText(event, data, appUrl)));
  }
  for (const r of await Promise.all(jobs)) if (!r.ok) console.warn(`Falha ao entregar ${event}: ${r.error ?? r.status}`);
}

const origin = (c: Ctx) => new URL(c.req.url).origin;

// ── Público ──────────────────────────────────────────────────────────────────
app.get("/health", async (c) => {
  const t = Date.now();
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ status: "ok", timestamp: now(), service: "prospex-worker", db: "ok", dbLatencyMs: Date.now() - t });
});

async function session(env: Env, user: { id: string; name: string; email: string }, ws: { id: string; name: string; slug: string }) {
  const token = await signJwt({ sub: user.id, workspaceId: ws.id, email: user.email }, env.JWT_SECRET);
  return { token, user, workspace: ws };
}

app.post("/auth/register", async (c) => {
  const b = await body<{ name?: string; email?: string; password?: string; workspaceName?: string }>(c);
  const email = (b.email ?? "").trim().toLowerCase();
  if (!b.name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("Informe nome e um e-mail válido");
  if (!b.password || b.password.length < 8) throw bad("A senha precisa ter pelo menos 8 caracteres");
  if (!b.workspaceName?.trim()) throw bad("Informe o nome do workspace");

  // Cadastro fechado: o 1º usuário vira dono; os demais só se convidados (REGISTRATION_ALLOWED_EMAILS).
  const users = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  const allowed = (c.env.REGISTRATION_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if ((users?.n ?? 0) > 0 && !allowed.includes(email)) {
    throw new HttpError(403, "Cadastro fechado. Peça um convite ao administrador do sistema.");
  }
  if (await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()) {
    throw new HttpError(409, "Este e-mail já está cadastrado");
  }

  const { hash, salt } = await hashPassword(b.password);
  const user = { id: newId(), name: b.name.trim(), email };
  const slugBase = b.workspaceName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const ws = { id: newId(), name: b.workspaceName.trim(), slug: `${slugBase || "workspace"}-${Date.now().toString(36)}` };
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users (id, name, email, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)").bind(user.id, user.name, email, hash, salt),
    c.env.DB.prepare("INSERT INTO workspaces (id, name, slug) VALUES (?, ?, ?)").bind(ws.id, ws.name, ws.slug),
    c.env.DB.prepare("INSERT INTO members (id, user_id, workspace_id, role) VALUES (?, ?, ?, 'owner')").bind(newId(), user.id, ws.id),
  ]);
  return c.json(await session(c.env, user, ws), 201);
});

app.post("/auth/login", async (c) => {
  const b = await body<{ email?: string; password?: string }>(c);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.password_hash, u.password_salt, w.id AS ws_id, w.name AS ws_name, w.slug AS ws_slug
     FROM users u JOIN members m ON m.user_id = u.id JOIN workspaces w ON w.id = m.workspace_id
     WHERE u.email = ? ORDER BY m.created_at LIMIT 1`,
  ).bind((b.email ?? "").trim().toLowerCase()).first<Row>();
  if (!row || !(await verifyPassword(b.password ?? "", String(row.password_hash), String(row.password_salt)))) {
    throw new HttpError(401, "E-mail ou senha inválidos");
  }
  return c.json(await session(
    c.env,
    { id: String(row.id), name: String(row.name), email: String(row.email) },
    { id: String(row.ws_id), name: String(row.ws_name), slug: String(row.ws_slug) },
  ));
});

app.post("/auth/logout", (c) => c.json({ ok: true }));

// ── Autenticação (JWT da sessão ou chave de API "ApiKey px_...") ──────────────
app.use("*", async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const claims = await verifyJwt(auth.slice(7), c.env.JWT_SECRET);
    if (!claims) throw new HttpError(401, "Sessão inválida ou expirada");
    c.set("userId", claims.sub);
    c.set("workspaceId", claims.workspaceId);
    return next();
  }
  if (auth.startsWith("ApiKey ")) {
    const key = await c.env.DB.prepare("SELECT id, workspace_id, expires_at FROM api_keys WHERE key_hash = ?")
      .bind(await sha256Hex(auth.slice(7))).first<Row>();
    if (!key) throw new HttpError(401, "Chave de API não encontrada ou revogada");
    if (key.expires_at && String(key.expires_at) < now()) throw new HttpError(401, "A chave de API expirou");
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now(), key.id).run());
    c.set("userId", "api-key");
    c.set("workspaceId", String(key.workspace_id));
    return next();
  }
  throw new HttpError(401, "Não autorizado. Faça login novamente");
});

// ── Campanhas ────────────────────────────────────────────────────────────────
const CAMPAIGN_SELECT = `SELECT c.*, (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = c.id) AS lead_count FROM campaigns c`;

async function findCampaign(env: Env, id: string, ws: string) {
  const r = await env.DB.prepare(`${CAMPAIGN_SELECT} WHERE c.id = ? AND c.workspace_id = ?`).bind(id, ws).first<Row>();
  if (!r) throw notFound(`Campanha ${id} não encontrada`);
  return r;
}

app.get("/campaigns", async (c) => {
  const { results } = await c.env.DB.prepare(`${CAMPAIGN_SELECT} WHERE c.workspace_id = ? ORDER BY c.created_at DESC`).bind(c.get("workspaceId")).all<Row>();
  return c.json(results.map(campaignOut));
});

app.get("/campaigns/:id", async (c) => c.json(campaignOut(await findCampaign(c.env, c.req.param("id"), c.get("workspaceId")))));

app.post("/campaigns", async (c) => {
  const b = await body<{
    name?: string; industry?: string; location?: string; searchQueries?: string[]; yourService?: string;
    description?: string; maxResults?: number; contentStyle?: string; language?: string;
  }>(c);
  if (!b.name?.trim() || !b.industry || !b.location?.trim() || !b.yourService?.trim()) {
    throw bad("Preencha nome, segmento, localização e seu serviço");
  }
  const id = newId();
  const max = Math.min(100, Math.max(1, Math.round(Number(b.maxResults) || 20)));
  await c.env.DB.prepare(
    `INSERT INTO campaigns (id, workspace_id, name, description, industry, location, search_queries, max_results, your_service, content_style, language)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, c.get("workspaceId"), b.name.trim(), b.description ?? null, b.industry, b.location.trim(),
    JSON.stringify((b.searchQueries ?? []).map((q) => String(q).trim()).filter(Boolean).slice(0, 10)),
    max, b.yourService.trim(), b.contentStyle || "balanced", b.language || "portuguese",
  ).run();
  return c.json(campaignOut(await findCampaign(c.env, id, c.get("workspaceId"))), 201);
});

app.delete("/campaigns/:id", async (c) => {
  await findCampaign(c.env, c.req.param("id"), c.get("workspaceId"));
  await c.env.DB.prepare("DELETE FROM campaigns WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

app.post("/scraper/campaigns/:id/start", async (c) => {
  const ws = c.get("workspaceId");
  const row = await findCampaign(c.env, c.req.param("id"), ws);
  if (row.status === "running") throw bad("Esta campanha já está em execução");
  await c.env.DB.prepare("UPDATE campaigns SET status = 'running', progress = 1, error = NULL, started_at = ?, updated_at = ? WHERE id = ?")
    .bind(now(), now(), row.id).run();
  c.executionCtx.waitUntil(runCampaign(c.env, origin(c), ws, campaignOut(row)));
  return c.json({ message: "Campaign queued", campaignId: row.id, jobId: row.id });
});

async function setProgress(env: Env, id: string, status: string, progress: number, error: string | null = null) {
  await env.DB.prepare(
    `UPDATE campaigns SET status = ?, progress = ?, error = ?, updated_at = ?${status === "completed" ? ", completed_at = ?" : ""} WHERE id = ?`,
  ).bind(...(status === "completed" ? [status, progress, error, now(), now(), id] : [status, progress, error, now(), id])).run();
}

async function runCampaign(env: Env, appUrl: string, ws: string, camp: ReturnType<typeof campaignOut>) {
  const id = String(camp.id);
  try {
    const places = await getIntegration(env, ws, "google_places");
    if (!places?.apiKey) throw new UserError("Cadastre a chave do Google Maps em Integrações → Google Maps antes de iniciar a campanha.");

    // "Curitiba, PR" é uma cidade só; só acrescenta a localização se o termo ainda não a cita.
    const area = String(camp.location);
    const city = area.split(",")[0].trim().toLowerCase();
    const queries = (camp.searchQueries.length ? camp.searchQueries : [String(camp.industry)])
      .map((q) => (q.toLowerCase().includes(city) ? q : `${q} ${area}`));
    const max = Number(camp.maxResults);
    const perQuery = Math.ceil(max / queries.length);

    const found = new Map<string, Awaited<ReturnType<typeof searchPlaces>>[number]>();
    for (let i = 0; i < queries.length; i++) {
      for (const p of await searchPlaces(places.apiKey, queries[i], perQuery, String(camp.language))) {
        if (!found.has(p.placeId)) found.set(p.placeId, p);
      }
      await setProgress(env, id, "running", Math.round(((i + 1) / queries.length) * 70));
    }
    const leads = [...found.values()].slice(0, max).map((p) => ({ ...p, ...scoreLead(p, String(camp.industry)) }));
    if (leads.length === 0) throw new UserError("Nenhuma empresa encontrada para essas buscas");

    await env.DB.batch(leads.map((l) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO leads (id, workspace_id, campaign_id, place_id, name, address, lat, lng, phone, website, rating,
          review_count, category, reference_url, has_website, score, priority, ai_analysis)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId(), ws, id, l.placeId, l.name, l.address, l.lat, l.lng, l.phone, l.website, l.rating, l.reviewCount,
        l.category, l.referenceUrl, l.hasWebsite ? 1 : 0, l.score, l.priority,
        JSON.stringify({ factors: l.factors, recommendation: l.recommendation }),
      )));

    const stats = {
      totalLeads: leads.length,
      priorityLeads: leads.filter((l) => l.priority === "HIGH").length,
      highQualityLeads: leads.filter((l) => l.score >= 70).length,
      averageScore: Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length),
    };
    await env.DB.prepare("UPDATE campaigns SET total_leads = ?, priority_leads = ?, high_quality_leads = ?, average_score = ? WHERE id = ?")
      .bind(stats.totalLeads, stats.priorityLeads, stats.highQualityLeads, stats.averageScore, id).run();
    await setProgress(env, id, "completed", 100);
    await emit(env, appUrl, ws, "campaign.completed", {
      campaign: { id, name: camp.name, industry: camp.industry, location: camp.location },
      stats,
      leads: leads.map(({ factors: _f, recommendation: _r, ...l }) => l),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Campanha ${id} falhou:`, msg);
    await setProgress(env, id, "failed", 0, msg);
    await emit(env, appUrl, ws, "campaign.failed", { campaign: { id, name: camp.name }, error: msg });
  }
}

// ── Leads ────────────────────────────────────────────────────────────────────
const LEAD_SELECT = `SELECT l.*, c.name AS campaign_name, o.name AS owner_name
  FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id LEFT JOIN users o ON o.id = l.owner_id`;

function leadSearch(q: string | undefined, where: string[], args: unknown[]) {
  if (!q) return;
  where.push("(l.name LIKE ? OR l.contact_name LIKE ? OR l.address LIKE ? OR l.category LIKE ? OR l.phone LIKE ? OR l.email LIKE ?)");
  const t = `%${q}%`;
  args.push(t, t, t, t, t, t);
}

async function isMember(env: Env, ws: string, userId: string) {
  return !!(await env.DB.prepare("SELECT 1 FROM members WHERE workspace_id = ? AND user_id = ?").bind(ws, userId).first());
}

// Campos editáveis do lead (API camelCase → coluna). "" = limpar o campo.
const LEAD_FIELDS: Record<string, string> = {
  name: "name", contactName: "contact_name", phone: "phone", email: "email", website: "website", address: "address",
  category: "category", dealValue: "deal_value", ownerId: "owner_id", expectedCloseDate: "expected_close_date",
  crmNotes: "crm_notes", priority: "priority",
};

async function leadValues(env: Env, ws: string, b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(LEAD_FIELDS)) {
    if (b[key] === undefined) continue;
    let v: unknown = b[key] === "" ? null : b[key];
    if (key === "name") {
      if (typeof v !== "string" || !v.trim()) throw bad("Informe o nome da empresa ou do cliente");
      v = v.trim().slice(0, 200);
    } else if (key === "dealValue") {
      if (v != null) {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw bad("Valor do negócio inválido");
        v = Math.round(n * 100) / 100;
      }
    } else if (key === "expectedCloseDate") {
      if (v != null) {
        const d = new Date(String(v));
        if (Number.isNaN(d.getTime())) throw bad("Data de previsão inválida");
        v = d.toISOString();
      }
    } else if (key === "priority") {
      if (!PRIORITY_PT[String(v)]) throw bad("Prioridade inválida");
    } else if (key === "ownerId") {
      if (v != null && !(await isMember(env, ws, String(v)))) throw bad("O responsável precisa ser um membro deste workspace");
    } else if (v != null) {
      v = String(v).trim().slice(0, key === "crmNotes" ? 5000 : 300) || null;
      if (key === "email" && v && !EMAIL_RE.test(String(v))) throw bad("E-mail inválido");
    }
    out[col] = v;
  }
  if ("website" in out) out.has_website = out.website ? 1 : 0;
  return out;
}

async function tasksFor(env: Env, leadId: string) {
  const { results } = await env.DB.prepare(`${TASK_SELECT} WHERE t.lead_id = ? ORDER BY t.done, t.scheduled_at`).bind(leadId).all<Row>();
  return results.map(taskOut);
}

async function activitiesFor(env: Env, ids: string[], perLead?: number) {
  const map = new Map<string, Array<{ id: string; type: string; note: string; createdAt: string }>>();
  if (!ids.length) return map;
  const { results } = await env.DB.prepare(
    `SELECT * FROM lead_activities WHERE lead_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`,
  ).bind(...ids).all<Row>();
  for (const a of results) {
    const list = map.get(String(a.lead_id)) ?? [];
    if (!perLead || list.length < perLead) list.push({ id: String(a.id), type: String(a.type), note: String(a.note ?? ""), createdAt: String(a.created_at) });
    map.set(String(a.lead_id), list);
  }
  return map;
}

app.get("/leads", async (c) => {
  const q = c.req.query();
  const where = ["l.workspace_id = ?"];
  const args: unknown[] = [c.get("workspaceId")];
  if (q.campaignId) { where.push("l.campaign_id = ?"); args.push(q.campaignId); }
  if (q.priority) { where.push("l.priority = ?"); args.push(q.priority); }
  if (q.status) { where.push("l.crm_status = ?"); args.push(q.status); }
  if (q.ownerId) { where.push("l.owner_id = ?"); args.push(q.ownerId); }
  leadSearch(q.q, where, args);
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
  const clause = where.join(" AND ");
  const [rows, total] = await Promise.all([
    c.env.DB.prepare(`${LEAD_SELECT} WHERE ${clause} ORDER BY l.score DESC, l.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...args, limit, (page - 1) * limit).all<Row>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM leads l WHERE ${clause}`).bind(...args).first<{ n: number }>(),
  ]);
  const acts = await activitiesFor(c.env, rows.results.map((r) => String(r.id)), 5);
  return c.json({
    data: rows.results.map((r) => ({ ...leadOut(r), activities: acts.get(String(r.id)) ?? [] })),
    total: total?.n ?? 0, page, limit,
  });
});

async function findLead(env: Env, id: string, ws: string) {
  const r = await env.DB.prepare(`${LEAD_SELECT} WHERE l.id = ? AND l.workspace_id = ?`).bind(id, ws).first<Row>();
  if (!r) throw notFound(`Lead ${id} não encontrado`);
  return r;
}

// Funil (Kanban): até 100 cards por etapa (mais recentes primeiro) + total e soma de valores de cada etapa.
app.get("/leads/pipeline", async (c) => {
  const ws = c.get("workspaceId");
  const q = c.req.query();
  const where = ["l.workspace_id = ?"];
  const args: unknown[] = [ws];
  if (q.ownerId) { where.push("l.owner_id = ?"); args.push(q.ownerId); }
  leadSearch(q.q, where, args);
  const clause = where.join(" AND ");
  const [cards, totals, next] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT * FROM (
         SELECT l.id, l.name, l.contact_name, l.phone, l.email, l.deal_value, l.priority, l.score, l.crm_status, l.source,
                l.expected_close_date, l.owner_id, l.updated_at, l.campaign_id, c.name AS campaign_name, o.name AS owner_name,
                ROW_NUMBER() OVER (PARTITION BY l.crm_status ORDER BY l.updated_at DESC) AS rn
         FROM leads l LEFT JOIN campaigns c ON c.id = l.campaign_id LEFT JOIN users o ON o.id = l.owner_id
         WHERE ${clause}
       ) WHERE rn <= 100`,
    ).bind(...args),
    c.env.DB.prepare(`SELECT crm_status, COUNT(*) AS n, COALESCE(SUM(deal_value), 0) AS total FROM leads l WHERE ${clause} GROUP BY crm_status`).bind(...args),
    c.env.DB.prepare(
      `SELECT * FROM (
         SELECT id, lead_id, type, note, scheduled_at, ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY scheduled_at) AS rn
         FROM tasks WHERE workspace_id = ? AND done = 0
       ) WHERE rn = 1`,
    ).bind(ws),
  ]);
  const nextTask = new Map((next.results as Row[]).map((t) => [String(t.lead_id), { id: t.id, type: t.type, note: t.note, scheduledAt: t.scheduled_at }]));
  const sums = new Map((totals.results as Row[]).map((t) => [String(t.crm_status), t]));
  const leads = (cards.results as Row[]).map((r) => ({
    id: r.id, name: r.name, contactName: r.contact_name ?? null, phone: r.phone ?? null, email: r.email ?? null,
    dealValue: r.deal_value ?? null, priority: r.priority, score: r.score, crmStatus: r.crm_status, source: r.source,
    expectedCloseDate: r.expected_close_date ?? null, ownerId: r.owner_id ?? null, updatedAt: r.updated_at,
    owner: r.owner_id ? { id: r.owner_id, name: r.owner_name ?? "" } : null,
    campaign: r.campaign_id ? { id: r.campaign_id, name: r.campaign_name ?? "" } : null,
    nextTask: nextTask.get(String(r.id)) ?? null,
  }));
  return c.json({
    stages: Object.keys(CRM_PT).map((status) => ({
      status,
      count: Number(sums.get(status)?.n ?? 0),
      value: Number(sums.get(status)?.total ?? 0),
      leads: leads.filter((l) => l.crmStatus === status),
    })),
  });
});

app.post("/leads", async (c) => {
  const ws = c.get("workspaceId");
  const b = await body<Record<string, unknown>>(c);
  if (b.name === undefined) throw bad("Informe o nome da empresa ou do cliente");
  const status = b.crmStatus ? String(b.crmStatus) : "new";
  if (!CRM_PT[status]) throw bad("Status inválido");
  // Sem responsável informado, fica com quem cadastrou (chave de API não é usuário).
  const userId = c.get("userId");
  if (b.ownerId === undefined && userId !== "api-key") b.ownerId = userId;
  const values = { ...(await leadValues(c.env, ws, b)), priority: b.priority ? String(b.priority) : "MEDIUM" };
  if (!PRIORITY_PT[String(values.priority)]) throw bad("Prioridade inválida");
  const id = newId();
  const cols = Object.keys(values);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO leads (id, workspace_id, source, crm_status, ${cols.join(", ")}) VALUES (?, ?, 'manual', ?, ${cols.map(() => "?").join(", ")})`,
    ).bind(id, ws, status, ...Object.values(values)),
    c.env.DB.prepare("INSERT INTO lead_activities (id, lead_id, type, note) VALUES (?, ?, 'lead_created', ?)")
      .bind(newId(), id, `Cadastrado manualmente em ${CRM_PT[status]}`),
  ]);
  const r = await findLead(c.env, id, ws);
  return c.json({ ...leadOut(r), activities: (await activitiesFor(c.env, [id])).get(id) ?? [], tasks: [] }, 201);
});

app.patch("/leads/:id", async (c) => {
  const ws = c.get("workspaceId");
  const before = await findLead(c.env, c.req.param("id"), ws);
  const values = await leadValues(c.env, ws, await body<Record<string, unknown>>(c));
  const cols = Object.keys(values);
  if (!cols.length) throw bad("Nada para atualizar");

  const changes: string[] = [];
  if ("deal_value" in values && values.deal_value !== (before.deal_value ?? null)) {
    changes.push(values.deal_value == null ? "valor removido" : `valor ${brl(Number(values.deal_value))}`);
  }
  if ("owner_id" in values && values.owner_id !== (before.owner_id ?? null)) {
    const owner = values.owner_id
      ? await c.env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(values.owner_id).first<{ name: string }>()
      : null;
    changes.push(owner ? `responsável ${owner.name}` : "sem responsável");
  }
  if ("expected_close_date" in values && values.expected_close_date !== (before.expected_close_date ?? null)) {
    changes.push(values.expected_close_date ? `previsão ${dateBr(String(values.expected_close_date))}` : "previsão removida");
  }
  if ("crm_notes" in values && values.crm_notes !== (before.crm_notes ?? null)) changes.push("observações");
  const contactCols = ["name", "contact_name", "phone", "email", "website", "address", "category", "priority"];
  if (contactCols.some((k) => k in values && values[k] !== (before[k] ?? null))) changes.push("dados de contato");

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...Object.values(values), now(), before.id),
    ...(changes.length
      ? [c.env.DB.prepare("INSERT INTO lead_activities (id, lead_id, type, note) VALUES (?, ?, 'deal_updated', ?)")
          .bind(newId(), before.id, `Atualizado: ${changes.join(", ")}`)]
      : []),
  ]);
  const id = String(before.id);
  const r = await findLead(c.env, id, ws);
  return c.json({ ...leadOut(r), activities: (await activitiesFor(c.env, [id])).get(id) ?? [], tasks: await tasksFor(c.env, id) });
});

app.delete("/leads/:id", async (c) => {
  const lead = await findLead(c.env, c.req.param("id"), c.get("workspaceId"));
  await c.env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(lead.id).run();
  return c.json({ ok: true });
});

app.get("/leads/:id", async (c) => {
  const ws = c.get("workspaceId");
  let r = await findLead(c.env, c.req.param("id"), ws);
  // Lead manual (sem campanha) não tem serviço/estilo de abordagem: não gera mensagens.
  if (!r.marketing_content && r.campaign_id) {
    // Mensagens geradas na 1ª abertura do lead (com a IA do workspace, se houver chave).
    const camp = await c.env.DB.prepare("SELECT industry, your_service, content_style, language FROM campaigns WHERE id = ?").bind(r.campaign_id).first<Row>();
    const content = await generateContent({
      businessName: String(r.name), address: r.address as string, industry: String(camp?.industry ?? ""),
      rating: r.rating as string, hasWebsite: !!r.has_website, yourService: String(camp?.your_service ?? ""),
      contentStyle: String(camp?.content_style ?? "balanced"), language: String(camp?.language ?? "portuguese"), score: Number(r.score),
    }, await aiConfig(c.env, ws));
    await c.env.DB.prepare("UPDATE leads SET marketing_content = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(content), now(), r.id).run();
    r = { ...r, marketing_content: JSON.stringify(content) };
  }
  const acts = await activitiesFor(c.env, [String(r.id)]);
  return c.json({ ...leadOut(r), activities: acts.get(String(r.id)) ?? [], tasks: await tasksFor(c.env, String(r.id)) });
});

async function changeStatus(c: Ctx, lead: Row, status: string, note: string, extra: Record<string, unknown> = {}) {
  const ws = c.get("workspaceId");
  const before = String(lead.crm_status);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE leads SET crm_status = ?, updated_at = ? WHERE id = ?").bind(status, now(), lead.id),
    c.env.DB.prepare("INSERT INTO lead_activities (id, lead_id, type, note) VALUES (?, ?, ?, ?)").bind(newId(), lead.id, extra.type ?? "crm_update", note),
  ]);
  if (status !== before) {
    c.executionCtx.waitUntil(emit(c.env, origin(c), ws, "lead.status_changed", {
      lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, website: lead.website, score: lead.score, priority: lead.priority },
      from: before, to: status,
    }));
  }
}

app.patch("/leads/:id/crm", async (c) => {
  const b = await body<{ crmStatus?: string; crmNotes?: string }>(c);
  const lead = await findLead(c.env, c.req.param("id"), c.get("workspaceId"));
  if (b.crmNotes !== undefined) {
    await c.env.DB.prepare("UPDATE leads SET crm_notes = ?, updated_at = ? WHERE id = ?").bind(b.crmNotes, now(), lead.id).run();
  }
  if (b.crmStatus) {
    if (!CRM_PT[b.crmStatus]) throw bad("Status inválido");
    if (b.crmStatus !== lead.crm_status) await changeStatus(c, lead, b.crmStatus, `Status alterado para ${CRM_PT[b.crmStatus]}`);
  }
  return c.json(leadOut(await findLead(c.env, lead.id as string, c.get("workspaceId"))));
});

// ── Análises ─────────────────────────────────────────────────────────────────
app.get("/analytics", async (c) => {
  const ws = c.get("workspaceId");
  const [total, active, pipeline] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE workspace_id = ?").bind(ws).first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE workspace_id = ? AND status IN ('running','completed')").bind(ws).first<{ n: number }>(),
    c.env.DB.prepare("SELECT crm_status AS status, COUNT(*) AS count, COALESCE(SUM(deal_value), 0) AS value FROM leads WHERE workspace_id = ? GROUP BY crm_status")
      .bind(ws).all<{ status: string; count: number; value: number }>(),
  ]);
  const totalLeads = total?.n ?? 0;
  const won = pipeline.results.find((p) => p.status === "won")?.count ?? 0;
  const valueOf = (pred: (s: string) => boolean) => pipeline.results.filter((p) => pred(p.status)).reduce((s, p) => s + p.value, 0);
  return c.json({
    totalLeads,
    activeCampaigns: active?.n ?? 0,
    conversionRate: `${totalLeads > 0 ? ((won / totalLeads) * 100).toFixed(1) : "0"}%`,
    dealsWon: won,
    // Soma dos valores dos negócios em aberto (fora de Ganho/Perdido) e dos ganhos.
    pipelineValue: valueOf((s) => s !== "won" && s !== "lost"),
    wonValue: valueOf((s) => s === "won"),
    crmPipeline: pipeline.results,
  });
});

app.get("/analytics/industries", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT category, COUNT(*) AS n, AVG(score) AS avg FROM leads WHERE workspace_id = ? GROUP BY category ORDER BY n DESC",
  ).bind(c.get("workspaceId")).all<{ category: string | null; n: number; avg: number | null }>();
  return c.json(results.map((r) => ({ category: r.category, _count: { id: r.n }, _avg: { score: r.avg } })));
});

app.get("/analytics/campaigns", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, status, total_leads, priority_leads, average_score, created_at, completed_at FROM campaigns WHERE workspace_id = ? ORDER BY created_at DESC",
  ).bind(c.get("workspaceId")).all<Row>();
  return c.json(results.map((r) => ({
    id: r.id, name: r.name, status: r.status, totalLeads: r.total_leads, priorityLeads: r.priority_leads,
    averageScore: r.average_score, createdAt: r.created_at, completedAt: r.completed_at,
  })));
});

// ── Exportação ───────────────────────────────────────────────────────────────
app.get("/export/leads/:format", async (c) => {
  const where = ["l.workspace_id = ?"];
  const args: unknown[] = [c.get("workspaceId")];
  if (c.req.query("campaignId")) { where.push("l.campaign_id = ?"); args.push(c.req.query("campaignId")); }
  const { results } = await c.env.DB.prepare(`${LEAD_SELECT} WHERE ${where.join(" AND ")} ORDER BY l.priority, l.score DESC`).bind(...args).all<Row>();
  const leads = results.map(leadOut);
  const format = c.req.param("format");

  if (format === "json") {
    return c.json(leads.map(({ aiAnalysis: _a, workspaceId: _w, ...l }) => ({ ...l, campaign: l.campaign?.name ?? null, owner: l.owner?.name ?? null })));
  }
  if (format === "vcard") {
    const vcf = leads.filter((l) => l.phone || l.email).map((l) => [
      "BEGIN:VCARD", "VERSION:3.0", `FN:${l.name}`,
      l.phone ? `TEL;TYPE=WORK:${l.phone}` : null, l.email ? `EMAIL;TYPE=WORK:${l.email}` : null,
      l.address ? `ADR;TYPE=WORK:;;${l.address};;;;` : null, l.website ? `URL:${l.website}` : null,
      `NOTE:Pontuação: ${l.score} | Prioridade: ${l.priority} | CRM: ${l.crmStatus}`, "END:VCARD",
    ].filter(Boolean).join("\r\n")).join("\r\n");
    return new Response(vcf, { headers: { "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": 'attachment; filename="leads.vcf"' } });
  }
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = [
    "Nome", "Contato", "Endereço", "Telefone", "E-mail", "Site", "Avaliação", "Nº de avaliações", "Pontuação", "Prioridade",
    "Status no CRM", "Valor (R$)", "Responsável", "Campanha", "Tem site", "Coletado em",
  ];
  const rows = leads.map((l) => [
    l.name, l.contactName, l.address, l.phone, l.email, l.website, l.rating, l.reviewCount, l.score, PRIORITY_PT[String(l.priority)] ?? l.priority,
    CRM_PT[String(l.crmStatus)] ?? l.crmStatus, l.dealValue != null ? Number(l.dealValue).toFixed(2).replace(".", ",") : "",
    l.owner?.name ?? "", l.campaign?.name ?? (l.source === "manual" ? "Cadastro manual" : ""), l.hasWebsite ? "Sim" : "Não",
    new Date(String(l.scrapedAt)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  ].map(esc).join(","));
  return new Response("﻿" + [header.join(","), ...rows].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="leads.csv"' },
  });
});

// ── Workspace e configurações ────────────────────────────────────────────────
app.get("/workspace", async (c) => {
  const w = await c.env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(c.get("workspaceId")).first<Row>();
  if (!w) throw notFound("Workspace não encontrado");
  return c.json({ id: w.id, name: w.name, slug: w.slug, logo: null, plan: "free", createdAt: w.created_at, updatedAt: w.updated_at });
});

app.patch("/workspace", async (c) => {
  const b = await body<{ name?: string; slug?: string }>(c);
  const ws = c.get("workspaceId");
  if (b.slug) {
    const taken = await c.env.DB.prepare("SELECT id FROM workspaces WHERE slug = ? AND id != ?").bind(b.slug, ws).first();
    if (taken) throw new HttpError(409, "Este identificador (slug) já está em uso");
  }
  await c.env.DB.prepare("UPDATE workspaces SET name = COALESCE(?, name), slug = COALESCE(?, slug), updated_at = ? WHERE id = ?")
    .bind(b.name?.trim() || null, b.slug?.trim() || null, now(), ws).run();
  const w = await c.env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(ws).first<Row>();
  return c.json({ id: w?.id, name: w?.name, slug: w?.slug });
});

app.get("/workspace/members", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.role, m.created_at, u.id AS user_id, u.name, u.email
     FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.created_at`,
  ).bind(c.get("workspaceId")).all<Row>();
  return c.json(results.map((m) => ({
    id: m.id, role: m.role, createdAt: m.created_at, user: { id: m.user_id, name: m.name, email: m.email, image: null },
  })));
});

// ── Tarefas e lembretes ──────────────────────────────────────────────────────
const TASK_SELECT = `SELECT t.*, l.name AS lead_name, l.phone AS lead_phone, l.crm_status AS lead_status,
    l.owner_id AS lead_owner_id, o.name AS lead_owner_name
  FROM tasks t JOIN leads l ON l.id = t.lead_id LEFT JOIN users o ON o.id = l.owner_id`;

/** Filtro por grupo: atrasadas (já passou da hora), hoje (até 23:59 de Brasília), próximas, abertas e concluídas. */
function taskBucket(bucket: string | undefined, where: string[], args: unknown[]) {
  const at = now();
  const end = endOfTodayBr().toISOString();
  if (bucket === "overdue") { where.push("t.done = 0 AND t.scheduled_at < ?"); args.push(at); }
  else if (bucket === "today") { where.push("t.done = 0 AND t.scheduled_at >= ? AND t.scheduled_at < ?"); args.push(at, end); }
  else if (bucket === "upcoming") { where.push("t.done = 0 AND t.scheduled_at >= ?"); args.push(end); }
  else if (bucket === "open") where.push("t.done = 0");
  else if (bucket === "done") where.push("t.done = 1");
}

async function findTask(env: Env, id: string, ws: string) {
  const r = await env.DB.prepare(`${TASK_SELECT} WHERE t.id = ? AND t.workspace_id = ?`).bind(id, ws).first<Row>();
  if (!r) throw notFound("Tarefa não encontrada");
  return r;
}

function taskInput(b: { type?: string; note?: string; scheduledAt?: string }, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (b.type !== undefined || !partial) {
    const type = b.type ?? "call";
    if (!TASK_TYPES[type]) throw bad("Tipo de tarefa inválido");
    out.type = type;
  }
  if (b.note !== undefined || !partial) {
    const note = String(b.note ?? "").trim();
    if (!note) throw bad("Descreva a tarefa");
    out.note = note.slice(0, 500);
  }
  if (b.scheduledAt !== undefined || !partial) {
    const d = new Date(String(b.scheduledAt ?? ""));
    if (Number.isNaN(d.getTime())) throw bad("Data inválida");
    out.scheduled_at = d.toISOString();
  }
  return out;
}

app.get("/tasks", async (c) => {
  const q = c.req.query();
  const where = ["t.workspace_id = ?"];
  const args: unknown[] = [c.get("workspaceId")];
  if (q.leadId) { where.push("t.lead_id = ?"); args.push(q.leadId); }
  if (q.ownerId) { where.push("l.owner_id = ?"); args.push(q.ownerId); }
  taskBucket(q.status, where, args);
  const order = q.status === "done" ? "t.done_at DESC" : "t.scheduled_at";
  const { results } = await c.env.DB.prepare(`${TASK_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 200`).bind(...args).all<Row>();
  return c.json(results.map(taskOut));
});

app.get("/tasks/summary", async (c) => {
  const ws = c.get("workspaceId");
  const ownerId = c.req.query("ownerId");
  const counts = await c.env.DB.batch((["overdue", "today", "upcoming"] as const).map((bucket) => {
    const where = ["t.workspace_id = ?"];
    const args: unknown[] = [ws];
    if (ownerId) { where.push("l.owner_id = ?"); args.push(ownerId); }
    taskBucket(bucket, where, args);
    return c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks t JOIN leads l ON l.id = t.lead_id WHERE ${where.join(" AND ")}`).bind(...args);
  }));
  const n = (i: number) => Number((counts[i].results[0] as { n: number } | undefined)?.n ?? 0);
  return c.json({ overdue: n(0), today: n(1), upcoming: n(2) });
});

app.post("/tasks", async (c) => {
  const ws = c.get("workspaceId");
  const b = await body<{ leadId?: string; type?: string; note?: string; scheduledAt?: string }>(c);
  if (!b.leadId) throw bad("Informe o lead da tarefa");
  const lead = await findLead(c.env, b.leadId, ws);
  const v = taskInput(b, false);
  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO tasks (id, workspace_id, lead_id, type, note, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, ws, lead.id, v.type, v.note, v.scheduled_at),
    c.env.DB.prepare("INSERT INTO lead_activities (id, lead_id, type, note) VALUES (?, ?, 'task_created', ?)")
      .bind(newId(), lead.id, `${TASK_TYPES[String(v.type)]} em ${whenBr(String(v.scheduled_at))}: ${v.note}`),
  ]);
  return c.json(taskOut(await findTask(c.env, id, ws)), 201);
});

app.patch("/tasks/:id", async (c) => {
  const ws = c.get("workspaceId");
  const before = await findTask(c.env, c.req.param("id"), ws);
  const b = await body<{ type?: string; note?: string; scheduledAt?: string; done?: boolean }>(c);
  const v = taskInput(b, true);
  if (b.done !== undefined) {
    if (typeof b.done !== "boolean") throw bad("Campo 'done' inválido");
    v.done = b.done ? 1 : 0;
    v.done_at = b.done ? now() : null;
  }
  const cols = Object.keys(v);
  if (!cols.length) throw bad("Nada para atualizar");
  const finished = b.done === true && !before.done;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tasks SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...Object.values(v), before.id),
    ...(finished
      ? [c.env.DB.prepare("INSERT INTO lead_activities (id, lead_id, type, note) VALUES (?, ?, 'task_done', ?)")
          .bind(newId(), before.lead_id, `${TASK_TYPES[String(v.type ?? before.type)] ?? "Tarefa"} concluída: ${v.note ?? before.note}`)]
      : []),
  ]);
  return c.json(taskOut(await findTask(c.env, String(before.id), ws)));
});

app.delete("/tasks/:id", async (c) => {
  const task = await findTask(c.env, c.req.param("id"), c.get("workspaceId"));
  await c.env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(task.id).run();
  return c.json({ ok: true });
});

app.get("/settings/integrations", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM integrations WHERE workspace_id = ?").bind(c.get("workspaceId")).all<Row>();
  const out = [];
  for (const r of results) {
    const config = parse<Record<string, string>>(r.config, {});
    for (const k of SECRET_KEYS) {
      if (config[k]) { const plain = await decryptSecret(config[k], c.env.ENCRYPTION_KEY); config[k] = `${MASK}${plain.slice(-4)}`; }
    }
    out.push({ id: r.id, type: r.type, name: r.name, enabled: !!r.enabled, config, createdAt: r.created_at, updatedAt: r.updated_at });
  }
  return c.json(out);
});

app.post("/settings/integrations", async (c) => {
  const b = await body<{ type?: string; name?: string; config?: Record<string, string> }>(c);
  if (!b.type || !b.config) throw bad("Informe o tipo e a configuração da integração");
  const ws = c.get("workspaceId");
  const existing = await c.env.DB.prepare("SELECT id, config FROM integrations WHERE workspace_id = ? AND type = ?").bind(ws, b.type).first<Row>();
  const previous = parse<Record<string, string>>(existing?.config, {});
  const config: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.config)) config[k] = String(v ?? "");
  for (const k of SECRET_KEYS) {
    if (config[k]?.startsWith(MASK)) config[k] = previous[k] ?? ""; // valor mascarado = não alterado
    else if (config[k]) config[k] = await encryptSecret(config[k], c.env.ENCRYPTION_KEY);
  }
  if (existing) {
    await c.env.DB.prepare("UPDATE integrations SET config = ?, name = ?, enabled = 1, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(config), b.name ?? b.type, now(), existing.id).run();
  } else {
    await c.env.DB.prepare("INSERT INTO integrations (id, workspace_id, type, name, config) VALUES (?, ?, ?, ?, ?)")
      .bind(newId(), ws, b.type, b.name ?? b.type, JSON.stringify(config)).run();
  }
  return c.json({ ok: true });
});

app.get("/settings/api-keys", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, prefix, last_used_at, expires_at, created_at FROM api_keys WHERE workspace_id = ? ORDER BY created_at DESC")
    .bind(c.get("workspaceId")).all<Row>();
  return c.json(results.map((k) => ({ id: k.id, name: k.name, keyPrefix: k.prefix, lastUsedAt: k.last_used_at, expiresAt: k.expires_at, createdAt: k.created_at })));
});

app.post("/settings/api-keys", async (c) => {
  const b = await body<{ name?: string }>(c);
  if (!b.name?.trim()) throw bad("Dê um nome para a chave");
  const plaintext = `px_${randomToken(32)}`;
  const id = newId();
  await c.env.DB.prepare("INSERT INTO api_keys (id, workspace_id, name, key_hash, prefix) VALUES (?, ?, ?, ?, ?)")
    .bind(id, c.get("workspaceId"), b.name.trim(), await sha256Hex(plaintext), plaintext.slice(0, 10)).run();
  return c.json({ id, name: b.name.trim(), keyPrefix: plaintext.slice(0, 10), key: plaintext, createdAt: now(), lastUsedAt: null, expiresAt: null }, 201);
});

app.delete("/settings/api-keys/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND workspace_id = ?").bind(c.req.param("id"), c.get("workspaceId")).run();
  if (!r.meta.changes) throw notFound("Chave de API não encontrada");
  return c.json({ ok: true });
});

// ── Integrações: teste, modelos do WhatsApp e envio ──────────────────────────
app.post("/integrations/:type/test", async (c) => {
  const type = c.req.param("type");
  const ws = c.get("workspaceId");
  const cfg = await getIntegration(c.env, ws, type);
  if (!cfg) throw bad("Salve a integração antes de testar");

  if (type === "google_places") {
    if (!cfg.apiKey) throw bad("Informe a chave do Google Maps");
    return c.json(await testPlacesKey(cfg.apiKey));
  }
  if (type === "webhook") {
    if (!cfg.url) throw bad("Informe a URL do webhook");
    return c.json(await sendWebhook(cfg, "test", ws, { message: "Teste do WishLead: integração funcionando" }));
  }
  if (type === "telegram") {
    if (!cfg.botToken || !cfg.chatId) throw bad("Informe o token do bot e o ID do chat");
    return c.json(await sendTelegram(cfg, telegramText("test", {}, origin(c))));
  }
  if (type === "whatsapp") {
    if (!cfg.accessToken || !cfg.phoneNumberId) throw bad("Conecte o WhatsApp em Integrações antes de testar.");
    const info = await graph<{ display_phone_number: string; verified_name: string; quality_rating?: string }>(
      cfg.accessToken, `/${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    );
    return c.json({ ok: true, phone: info.display_phone_number, name: info.verified_name, quality: info.quality_rating ?? null });
  }
  throw bad("Esta integração não tem teste");
});

app.get("/integrations/whatsapp/templates", async (c) => {
  const cfg = await getIntegration(c.env, c.get("workspaceId"), "whatsapp");
  if (!cfg?.accessToken || !cfg.wabaId) return c.json([]);
  const res = await graph<{ data: Array<{ name: string; status: string; language: string; components: Array<{ type: string; text?: string }> }> }>(
    cfg.accessToken, `/${cfg.wabaId}/message_templates?fields=name,status,language,components&limit=100`,
  );
  return c.json(res.data.filter((t) => t.status === "APPROVED").map((t) => ({
    name: t.name, language: t.language, body: t.components.find((x) => x.type === "BODY")?.text ?? "",
  })));
});

app.post("/integrations/whatsapp/send/:leadId", async (c) => {
  const b = await body<{ mode?: "template" | "text"; text?: string }>(c);
  if (b.mode !== "template" && b.mode !== "text") throw bad("Modo de envio inválido");
  const ws = c.get("workspaceId");
  const cfg = await getIntegration(c.env, ws, "whatsapp");
  if (!cfg?.accessToken || !cfg.phoneNumberId) throw bad("Conecte o WhatsApp em Integrações antes de enviar.");
  const lead = await findLead(c.env, c.req.param("leadId"), ws);
  if (!lead.phone) throw bad("Este lead não tem telefone.");
  const message = b.text?.trim() || parse<{ whatsapp?: string }>(lead.marketing_content, {}).whatsapp || "";
  if (!message) throw bad("Este lead ainda não tem mensagem de WhatsApp gerada.");

  const result = await sendWhatsApp(cfg, String(lead.phone), { mode: b.mode, businessName: String(lead.name), message });
  const note = b.mode === "template" ? "WhatsApp enviado (modelo aprovado)" : "WhatsApp enviado (texto)";
  if (lead.crm_status === "new") {
    await changeStatus(c, lead, "contacted", note, { type: "whatsapp_sent" });
  } else {
    await c.env.DB.prepare("INSERT INTO lead_activities (id, lead_id, type, note) VALUES (?, ?, 'whatsapp_sent', ?)").bind(newId(), lead.id, note).run();
  }
  return c.json({ ...result, crmStatus: lead.crm_status === "new" ? "contacted" : lead.crm_status });
});

app.all("*", (c) => c.json({ statusCode: 404, message: "Recurso não encontrado", timestamp: now(), path: new URL(c.req.url).pathname }, 404));

// ── Lembrete diário (cron das 8h de Brasília, ver [triggers] no wrangler.toml) ──
// Envia a cada workspace com Telegram/Webhook as tarefas atrasadas e as de hoje.
async function dailyDigest(env: Env) {
  const at = now();
  const { results } = await env.DB.prepare(
    `SELECT t.workspace_id, t.id, t.type, t.note, t.scheduled_at, l.id AS lead_id, l.name AS lead_name, l.phone AS lead_phone, o.name AS owner_name
     FROM tasks t JOIN leads l ON l.id = t.lead_id LEFT JOIN users o ON o.id = l.owner_id
     WHERE t.done = 0 AND t.scheduled_at < ? ORDER BY t.scheduled_at`,
  ).bind(endOfTodayBr().toISOString()).all<Row>();

  const byWorkspace = new Map<string, Row[]>();
  for (const r of results) byWorkspace.set(String(r.workspace_id), [...(byWorkspace.get(String(r.workspace_id)) ?? []), r]);
  const date = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const appUrl = (env.APP_URL ?? "").replace(/\/$/, "");

  for (const [ws, rows] of byWorkspace) {
    const item = (r: Row) => ({
      id: r.id, type: r.type, note: r.note, scheduledAt: r.scheduled_at,
      lead: { id: r.lead_id, name: r.lead_name, phone: r.lead_phone ?? null, owner: r.owner_name ?? null },
    });
    await emit(env, appUrl, ws, "tasks.daily_digest", {
      date,
      overdue: rows.filter((r) => String(r.scheduled_at) < at).map(item),
      today: rows.filter((r) => String(r.scheduled_at) >= at).map(item),
    }).catch((err) => console.error(`Resumo diário do workspace ${ws} falhou:`, err));
  }
}

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dailyDigest(env));
  },
} satisfies ExportedHandler<Env>;
