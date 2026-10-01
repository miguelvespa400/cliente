// Modo demonstração: responde às chamadas da API no próprio navegador, com dados fictícios.
// Ativado com NEXT_PUBLIC_DEMO_MODE=true (build estático do GitHub Pages). Alterações do visitante
// (status no CRM, campanha simulada, chaves de API) ficam só no localStorage dele.
import {
  DEMO_NEW_CAMPAIGN_ID,
  DEMO_NEW_LEAD_COUNT,
  DEMO_SEEDS,
  DEMO_SEED_LEADS,
  buildDemoCampaign,
  buildDemoLeads,
  type DemoCampaignInput,
  type DemoLead,
} from "./demo-data";
import { CRM_STATUS_LABELS, PRIORITY_LABELS } from "./labels";

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const STATE_KEY = "prospex_demo_state";
const SIMULATED_RUN_MS = 25_000;

export const DEMO_SESSION = {
  token: "demo",
  user: { id: "demo-user", name: "Visitante", email: "visitante@demo.prospex" },
  workspace: { id: "demo-workspace", name: "Netwish (demonstração)", slug: "netwish-demo" },
};

interface DemoState {
  crm: Record<string, string>;
  activities: Record<string, Array<{ id: string; type: string; note: string; createdAt: string }>>;
  nova: (DemoCampaignInput & { startedAt: string }) | null;
  workspaceName: string;
  apiKeys: Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: null; expiresAt: null }>;
  integrations: Array<{ type: string; config: Record<string, string> }>;
}

function loadState(): DemoState {
  const empty: DemoState = { crm: {}, activities: {}, nova: null, workspaceName: DEMO_SESSION.workspace.name, apiKeys: [], integrations: [] };
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(STATE_KEY) || "{}") };
  } catch {
    return empty;
  }
}

function saveState(s: DemoState) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* modo privado */ }
}

export function ensureDemoSession() {
  try {
    if (!localStorage.getItem("prospex_token")) {
      localStorage.setItem("prospex_token", DEMO_SESSION.token);
      localStorage.setItem("prospex_user", JSON.stringify({ user: DEMO_SESSION.user, workspace: DEMO_SESSION.workspace }));
    }
  } catch { /* modo privado: guard segue sem sessão persistida */ }
}

function novaProgress(s: DemoState) {
  if (!s.nova) return null;
  const elapsed = Date.now() - new Date(s.nova.startedAt).getTime();
  const progress = Math.min(100, Math.round((elapsed / SIMULATED_RUN_MS) * 100));
  return { progress, status: progress >= 100 ? "completed" : "running" };
}

function allLeads(s: DemoState): DemoLead[] {
  const leads = [...DEMO_SEED_LEADS];
  const run = novaProgress(s);
  if (s.nova && run?.status === "completed") {
    leads.push(...buildDemoLeads(s.nova, DEMO_NEW_LEAD_COUNT, DEMO_NEW_CAMPAIGN_ID, false));
  }
  return leads.map((l) => ({
    ...l,
    crmStatus: s.crm[l.id] ?? l.crmStatus,
    activities: s.activities[l.id] ?? l.activities,
  }));
}

function allCampaigns(s: DemoState) {
  const leads = allLeads(s);
  const list = DEMO_SEEDS.map((seed) =>
    buildDemoCampaign(seed, leads.filter((l) => l.campaignId === seed.id), "completed", 100),
  );
  const run = novaProgress(s);
  if (s.nova && run) {
    list.push(buildDemoCampaign(s.nova, leads.filter((l) => l.campaignId === DEMO_NEW_CAMPAIGN_ID), run.status, run.progress));
  }
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

class DemoNotFound extends Error {}

export async function demoRequest<T>(method: string, rawPath: string, body?: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, 150)); // latência leve, para os skeletons aparecerem
  const s = loadState();
  const url = new URL(rawPath, "http://demo");
  const path = url.pathname.replace(/\/$/, "");
  const q = url.searchParams;
  const b = (body ?? {}) as Record<string, unknown>;
  let m: RegExpMatchArray | null;

  if (method === "GET" && path === "/campaigns") return allCampaigns(s) as T;
  if (method === "GET" && (m = path.match(/^\/campaigns\/([^/]+)$/))) {
    const c = allCampaigns(s).find((x) => x.id === m![1]);
    if (!c) throw new DemoNotFound("Campanha não encontrada");
    return c as T;
  }
  if (method === "POST" && path === "/campaigns") {
    s.nova = {
      id: DEMO_NEW_CAMPAIGN_ID,
      name: String(b.name || "Nova campanha"),
      industry: String(b.industry || "professional"),
      location: String(b.location || "São Paulo, SP"),
      searchQueries: (b.searchQueries as string[])?.length ? (b.searchQueries as string[]) : ["negócios locais"],
      yourService: String(b.yourService || "seu serviço"),
      contentStyle: String(b.contentStyle || "balanced"),
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    };
    // Nova campanha reaproveita o mesmo slot: limpa status de CRM antigos dos leads simulados.
    for (const k of Object.keys(s.crm)) if (k.startsWith(DEMO_NEW_CAMPAIGN_ID)) delete s.crm[k];
    for (const k of Object.keys(s.activities)) if (k.startsWith(DEMO_NEW_CAMPAIGN_ID)) delete s.activities[k];
    saveState(s);
    return { id: DEMO_NEW_CAMPAIGN_ID } as T;
  }
  if (method === "POST" && /^\/scraper\/campaigns\/[^/]+\/start$/.test(path)) {
    if (s.nova) { s.nova.startedAt = new Date().toISOString(); saveState(s); }
    return { message: "Campaign queued" } as T;
  }

  if (method === "GET" && path === "/leads") {
    let leads = allLeads(s);
    if (q.get("campaignId")) leads = leads.filter((l) => l.campaignId === q.get("campaignId"));
    if (q.get("priority")) leads = leads.filter((l) => l.priority === q.get("priority"));
    if (q.get("status")) leads = leads.filter((l) => l.crmStatus === q.get("status"));
    if (q.get("q")) {
      const term = q.get("q")!.toLowerCase();
      leads = leads.filter((l) => `${l.name} ${l.address} ${l.category}`.toLowerCase().includes(term));
    }
    leads.sort((a, b) => b.score - a.score);
    const page = Number(q.get("page") || 1);
    const limit = Number(q.get("limit") || 50);
    return { data: leads.slice((page - 1) * limit, page * limit), total: leads.length, page, limit } as T;
  }
  if (method === "GET" && (m = path.match(/^\/leads\/([^/]+)$/))) {
    const lead = allLeads(s).find((l) => l.id === m![1]);
    if (!lead) throw new DemoNotFound("Lead não encontrado");
    return { ...lead, followUps: [] } as T;
  }
  if (method === "PATCH" && (m = path.match(/^\/leads\/([^/]+)\/crm$/))) {
    const id = m[1];
    const status = String(b.crmStatus);
    s.crm[id] = status;
    s.activities[id] = [
      { id: `${id}-a${Date.now()}`, type: "crm_update", note: `Status alterado para ${CRM_STATUS_LABELS[status] ?? status}`, createdAt: new Date().toISOString() },
      ...(s.activities[id] ?? []),
    ];
    saveState(s);
    return { id, crmStatus: status } as T;
  }

  if (method === "GET" && path === "/analytics") {
    const leads = allLeads(s);
    const won = leads.filter((l) => l.crmStatus === "won").length;
    const contacted = leads.filter((l) => l.crmStatus !== "new").length;
    const pipeline = Object.keys(CRM_STATUS_LABELS)
      .map((status) => ({ status, count: leads.filter((l) => l.crmStatus === status).length }))
      .filter((p) => p.count > 0);
    return {
      totalLeads: leads.length,
      activeCampaigns: allCampaigns(s).length,
      conversionRate: contacted ? `${((won / contacted) * 100).toFixed(1)}%` : "0.0%",
      dealsWon: won,
      crmPipeline: pipeline,
    } as T;
  }
  if (method === "GET" && path === "/analytics/industries") {
    const groups = new Map<string, DemoLead[]>();
    for (const l of allLeads(s)) groups.set(l.category, [...(groups.get(l.category) ?? []), l]);
    return [...groups.entries()]
      .map(([category, ls]) => ({ category, _count: { id: ls.length }, _avg: { score: Math.round(ls.reduce((a, l) => a + l.score, 0) / ls.length) } }))
      .sort((a, b) => b._count.id - a._count.id) as T;
  }

  if (method === "GET" && path === "/workspace") {
    return { ...DEMO_SESSION.workspace, name: s.workspaceName, logo: null, plan: "free", createdAt: "2026-09-20T12:00:00.000Z", updatedAt: new Date().toISOString() } as T;
  }
  if (method === "PATCH" && path === "/workspace") {
    if (b.name) s.workspaceName = String(b.name);
    saveState(s);
    return { ...DEMO_SESSION.workspace, name: s.workspaceName } as T;
  }
  if (method === "GET" && path === "/settings/api-keys") return s.apiKeys as T;
  if (method === "POST" && path === "/settings/api-keys") {
    const id = `demo-key-${Date.now()}`;
    const key = `px_demo_${Math.random().toString(36).slice(2, 14)}`;
    const entry = { id, name: String(b.name || "Chave"), prefix: key.slice(0, 12), createdAt: new Date().toISOString(), lastUsedAt: null, expiresAt: null };
    s.apiKeys.unshift(entry);
    saveState(s);
    return { ...entry, key } as T;
  }
  if (method === "DELETE" && (m = path.match(/^\/settings\/api-keys\/([^/]+)$/))) {
    s.apiKeys = s.apiKeys.filter((k) => k.id !== m![1]);
    saveState(s);
    return { ok: true } as T;
  }
  if (method === "GET" && path === "/settings/integrations") return s.integrations as T;
  if (method === "POST" && path === "/settings/integrations") {
    // Na demo nada é enviado a lugar nenhum; guardamos só o modelo, nunca a chave digitada.
    const cfg = (b.config ?? {}) as Record<string, string>;
    s.integrations = [...s.integrations.filter((i) => i.type !== b.type), { type: String(b.type), config: { model: cfg.model ?? "" } }];
    saveState(s);
    return { ok: true } as T;
  }

  throw new DemoNotFound(`Indisponível na demonstração: ${method} ${path}`);
}

export async function demoDownload(rawPath: string, filename: string) {
  const s = loadState();
  const url = new URL(rawPath, "http://demo");
  const campaignId = url.searchParams.get("campaignId");
  const leads = allLeads(s).filter((l) => !campaignId || l.campaignId === campaignId);
  let content: string;
  let type: string;
  if (url.pathname.endsWith("/json")) {
    content = JSON.stringify(leads, null, 2);
    type = "application/json";
  } else if (url.pathname.endsWith("/vcard")) {
    content = leads
      .map((l) => ["BEGIN:VCARD", "VERSION:3.0", `FN:${l.name}`, `TEL;TYPE=WORK:${l.phone}`, l.email ? `EMAIL;TYPE=WORK:${l.email}` : null, "END:VCARD"].filter(Boolean).join("\r\n"))
      .join("\r\n");
    type = "text/vcard";
  } else {
    const esc = (v: unknown) => {
      const t = v == null ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const header = ["Nome", "Endereço", "Telefone", "E-mail", "Site", "Avaliação", "Nº de avaliações", "Pontuação", "Prioridade", "Status no CRM", "Campanha"];
    const rows = leads.map((l) =>
      [l.name, l.address, l.phone, l.email, l.website, l.rating, l.reviewCount, l.score, PRIORITY_LABELS[l.priority], CRM_STATUS_LABELS[l.crmStatus], l.campaign.name].map(esc).join(","),
    );
    content = "﻿" + [header.join(","), ...rows].join("\n");
    type = "text/csv;charset=utf-8";
  }
  const blobUrl = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}
