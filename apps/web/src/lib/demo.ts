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
  user: { id: "demo-user", name: "Visitante", email: "visitante@demo.wishlead" },
  workspace: { id: "demo-workspace", name: "Netwish (demonstração)", slug: "netwish-demo" },
};

type Activity = { id: string; type: string; note: string; createdAt: string };

interface DemoTask {
  id: string; leadId: string; type: string; note: string; scheduledAt: string; done: boolean; doneAt: string | null; createdAt: string;
}

/** Campos de negócio editáveis na demo (valor, responsável, contato...). */
type DealFields = Partial<{
  name: string; contactName: string | null; phone: string; email: string | null; website: string; address: string;
  category: string | null; dealValue: number | null; ownerId: string | null; expectedCloseDate: string | null;
  crmNotes: string | null; priority: "HIGH" | "MEDIUM" | "LOW";
}>;

type CrmLead = Omit<DemoLead, "campaign" | "campaignId" | "crmNotes"> & {
  crmNotes: string | null;
  campaign: { id: string; name: string } | null;
  campaignId: string | null;
  contactName: string | null;
  dealValue: number | null;
  expectedCloseDate: string | null;
  ownerId: string | null;
  owner: { id: string; name: string } | null;
};

interface DemoState {
  crm: Record<string, string>;
  activities: Record<string, Activity[]>;
  nova: (DemoCampaignInput & { startedAt: string }) | null;
  workspaceName: string;
  apiKeys: Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: null; expiresAt: null }>;
  integrations: Array<{ type: string; config: Record<string, string> }>;
  manual: CrmLead[];
  edits: Record<string, DealFields>;
  deleted: string[];
  tasks: DemoTask[] | null;
}

function loadState(): DemoState {
  const empty: DemoState = {
    crm: {}, activities: {}, nova: null, workspaceName: DEMO_SESSION.workspace.name, apiKeys: [], integrations: [],
    manual: [], edits: {}, deleted: [], tasks: null,
  };
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

const DEMO_OWNER = { id: DEMO_SESSION.user.id, name: DEMO_SESSION.user.name };

/** Valor fictício e responsável para os leads de exemplo que já avançaram no funil. */
function seedDeal(l: DemoLead, status: string): DealFields {
  if (status === "new") return {};
  return {
    dealValue: ["meeting", "proposal", "won"].includes(status) ? Math.round((1200 + l.score * 45) / 100) * 100 : null,
    ownerId: DEMO_OWNER.id,
  };
}

function allLeads(s: DemoState): CrmLead[] {
  const leads = [...DEMO_SEED_LEADS];
  const run = novaProgress(s);
  if (s.nova && run?.status === "completed") {
    leads.push(...buildDemoLeads(s.nova, DEMO_NEW_LEAD_COUNT, DEMO_NEW_CAMPAIGN_ID, false));
  }
  const fromCampaigns: CrmLead[] = leads.map((l) => {
    const crmStatus = (s.crm[l.id] ?? l.crmStatus) as DemoLead["crmStatus"];
    const deal = { ...seedDeal(l, l.crmStatus), ...s.edits[l.id] };
    return {
      ...l,
      ...deal,
      crmStatus,
      activities: s.activities[l.id] ?? l.activities,
      contactName: deal.contactName ?? null,
      dealValue: deal.dealValue ?? null,
      expectedCloseDate: deal.expectedCloseDate ?? null,
      ownerId: deal.ownerId ?? null,
      owner: deal.ownerId ? DEMO_OWNER : null,
    } as CrmLead;
  });
  const manual = s.manual.map((l) => ({
    ...l,
    ...s.edits[l.id],
    crmStatus: (s.crm[l.id] ?? l.crmStatus) as DemoLead["crmStatus"],
    activities: s.activities[l.id] ?? l.activities,
    owner: (s.edits[l.id]?.ownerId ?? l.ownerId) ? DEMO_OWNER : null,
  }) as CrmLead);
  return [...manual, ...fromCampaigns].filter((l) => !s.deleted.includes(l.id));
}

/** Tarefas de exemplo (uma atrasada, uma hoje, algumas futuras), criadas na 1ª visita. */
function demoTasks(s: DemoState): DemoTask[] {
  if (s.tasks) return s.tasks;
  const at = (days: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  const pick = (status: string) => DEMO_SEED_LEADS.filter((l) => l.crmStatus === status);
  const plan: Array<[DemoLead | undefined, string, string, string]> = [
    [pick("contacted")[0], "call", "Ligar para confirmar se recebeu a mensagem", at(-1, 10)],
    [pick("replied")[0], "whatsapp", "Mandar exemplos de trabalhos parecidos", at(0, 17)],
    [pick("meeting")[0], "meeting", "Reunião de apresentação (Google Meet)", at(1, 9)],
    [pick("proposal")[0], "email", "Enviar proposta revisada com desconto à vista", at(2, 14)],
    [pick("contacted")[1], "call", "Retornar ligação", at(4, 11)],
  ];
  s.tasks = plan.filter(([l]) => l).map(([l, type, note, scheduledAt], i) => ({
    id: `demo-task-${i + 1}`, leadId: l!.id, type, note, scheduledAt, done: false, doneAt: null, createdAt: new Date().toISOString(),
  }));
  saveState(s);
  return s.tasks;
}

function taskOut(t: DemoTask, leads: CrmLead[]) {
  const l = leads.find((x) => x.id === t.leadId);
  return { ...t, lead: l ? { id: l.id, name: l.name, phone: l.phone, crmStatus: l.crmStatus, ownerId: l.ownerId, owner: l.owner } : undefined };
}

function endOfToday() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function inBucket(t: DemoTask, bucket: string | null) {
  const when = new Date(t.scheduledAt).getTime();
  if (bucket === "overdue") return !t.done && when < Date.now();
  if (bucket === "today") return !t.done && when >= Date.now() && when < endOfToday();
  if (bucket === "upcoming") return !t.done && when >= endOfToday();
  if (bucket === "open") return !t.done;
  if (bucket === "done") return t.done;
  return true;
}

function logActivity(s: DemoState, leadId: string, type: string, note: string, base: Activity[] = []) {
  s.activities[leadId] = [{ id: `${leadId}-a${Date.now()}`, type, note, createdAt: new Date().toISOString() }, ...(s.activities[leadId] ?? base)];
}

const TASK_PT: Record<string, string> = { call: "Ligar", whatsapp: "WhatsApp", email: "E-mail", meeting: "Reunião", visit: "Visita", other: "Tarefa" };

function allCampaigns(s: DemoState) {
  const leads = allLeads(s);
  const list = DEMO_SEEDS.map((seed) =>
    buildDemoCampaign(seed, leads.filter((l) => l.campaignId === seed.id) as unknown as DemoLead[], "completed", 100),
  );
  const run = novaProgress(s);
  if (s.nova && run) {
    list.push(buildDemoCampaign(s.nova, leads.filter((l) => l.campaignId === DEMO_NEW_CAMPAIGN_ID) as unknown as DemoLead[], run.status, run.progress));
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

  const filterLeads = (leads: CrmLead[]) => {
    if (q.get("ownerId")) leads = leads.filter((l) => l.ownerId === q.get("ownerId"));
    if (q.get("q")) {
      const term = q.get("q")!.toLowerCase();
      leads = leads.filter((l) => `${l.name} ${l.contactName ?? ""} ${l.address} ${l.category} ${l.phone}`.toLowerCase().includes(term));
    }
    return leads;
  };

  if (method === "GET" && path === "/leads") {
    let leads = filterLeads(allLeads(s));
    if (q.get("campaignId")) leads = leads.filter((l) => l.campaignId === q.get("campaignId"));
    if (q.get("priority")) leads = leads.filter((l) => l.priority === q.get("priority"));
    if (q.get("status")) leads = leads.filter((l) => l.crmStatus === q.get("status"));
    leads.sort((a, b) => b.score - a.score);
    const page = Number(q.get("page") || 1);
    const limit = Number(q.get("limit") || 50);
    return { data: leads.slice((page - 1) * limit, page * limit), total: leads.length, page, limit } as T;
  }
  if (method === "GET" && path === "/leads/pipeline") {
    const leads = filterLeads(allLeads(s));
    const open = demoTasks(s).filter((t) => !t.done).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return {
      stages: Object.keys(CRM_STATUS_LABELS).map((status) => {
        const inStage = leads.filter((l) => l.crmStatus === status);
        return {
          status,
          count: inStage.length,
          value: inStage.reduce((sum, l) => sum + (l.dealValue ?? 0), 0),
          leads: inStage.map((l) => {
            const t = open.find((x) => x.leadId === l.id);
            return { ...l, nextTask: t ? { id: t.id, type: t.type, note: t.note, scheduledAt: t.scheduledAt } : null };
          }),
        };
      }),
    } as T;
  }
  if (method === "POST" && path === "/leads") {
    const id = `demo-manual-${Date.now()}`;
    const status = String(b.crmStatus || "new") as DemoLead["crmStatus"];
    const nowIso = new Date().toISOString();
    const ownerId = b.ownerId === undefined ? DEMO_OWNER.id : (b.ownerId as string | null);
    const lead: CrmLead = {
      id, name: String(b.name || "Novo lead"), address: String(b.address ?? ""), lat: null as unknown as number, lng: null as unknown as number,
      phone: String(b.phone ?? ""), email: (b.email as string) || null, website: String(b.website ?? ""), rating: "N/A", reviewCount: 0,
      category: (b.category as string) || "", source: "manual", referenceUrl: "", hasWebsite: !!b.website, score: 0,
      priority: (b.priority as DemoLead["priority"]) || "MEDIUM", aiAnalysis: { factors: [], recommendation: "" }, marketingContent: null,
      crmStatus: status, crmNotes: (b.crmNotes as string) || null, campaignId: null, campaign: null, activities: [],
      scrapedAt: nowIso, createdAt: nowIso, updatedAt: nowIso,
      contactName: (b.contactName as string) || null, dealValue: (b.dealValue as number | null) ?? null,
      expectedCloseDate: (b.expectedCloseDate as string | null) ?? null, ownerId, owner: ownerId ? DEMO_OWNER : null,
    };
    s.manual.unshift(lead);
    logActivity(s, id, "lead_created", `Cadastrado manualmente em ${CRM_STATUS_LABELS[status]}`);
    saveState(s);
    return { ...lead, activities: s.activities[id], tasks: [] } as T;
  }
  if (method === "GET" && (m = path.match(/^\/leads\/([^/]+)$/))) {
    const leads = allLeads(s);
    const lead = leads.find((l) => l.id === m![1]);
    if (!lead) throw new DemoNotFound("Lead não encontrado");
    const tasks = demoTasks(s).filter((t) => t.leadId === lead.id)
      .sort((a, b) => Number(a.done) - Number(b.done) || a.scheduledAt.localeCompare(b.scheduledAt));
    return { ...lead, tasks: tasks.map((t) => taskOut(t, leads)) } as T;
  }
  if (method === "PATCH" && (m = path.match(/^\/leads\/([^/]+)$/))) {
    const id = m[1];
    const before = allLeads(s).find((l) => l.id === id);
    if (!before) throw new DemoNotFound("Lead não encontrado");
    const fields = ["name", "contactName", "phone", "email", "website", "address", "category", "dealValue", "ownerId", "expectedCloseDate", "crmNotes", "priority"];
    const patch = Object.fromEntries(Object.entries(b).filter(([k, v]) => fields.includes(k) && v !== undefined).map(([k, v]) => [k, v === "" ? null : v]));
    s.edits[id] = { ...s.edits[id], ...patch };
    const changes = [
      "dealValue" in patch && patch.dealValue !== before.dealValue && (patch.dealValue == null ? "valor removido" : `valor R$ ${Number(patch.dealValue).toLocaleString("pt-BR")}`),
      "crmNotes" in patch && patch.crmNotes !== before.crmNotes && "observações",
      "expectedCloseDate" in patch && patch.expectedCloseDate !== before.expectedCloseDate && "previsão de fechamento",
    ].filter(Boolean);
    if (changes.length) logActivity(s, id, "deal_updated", `Atualizado: ${changes.join(", ")}`, before.activities);
    saveState(s);
    return demoRequest<T>("GET", `/leads/${id}`);
  }
  if (method === "DELETE" && (m = path.match(/^\/leads\/([^/]+)$/))) {
    s.deleted.push(m[1]);
    s.manual = s.manual.filter((l) => l.id !== m![1]);
    if (s.tasks) s.tasks = s.tasks.filter((t) => t.leadId !== m![1]);
    saveState(s);
    return { ok: true } as T;
  }
  if (method === "PATCH" && (m = path.match(/^\/leads\/([^/]+)\/crm$/))) {
    const id = m[1];
    const status = String(b.crmStatus);
    const before = allLeads(s).find((l) => l.id === id);
    s.crm[id] = status;
    logActivity(s, id, "crm_update", `Status alterado para ${CRM_STATUS_LABELS[status] ?? status}`, before?.activities);
    saveState(s);
    return { id, crmStatus: status } as T;
  }

  if (method === "GET" && path === "/tasks") {
    const leads = allLeads(s);
    const status = q.get("status");
    let tasks = demoTasks(s).filter((t) => inBucket(t, status) && leads.some((l) => l.id === t.leadId));
    if (q.get("leadId")) tasks = tasks.filter((t) => t.leadId === q.get("leadId"));
    if (q.get("ownerId")) tasks = tasks.filter((t) => leads.find((l) => l.id === t.leadId)?.ownerId === q.get("ownerId"));
    tasks.sort((a, b) => status === "done" ? (b.doneAt ?? "").localeCompare(a.doneAt ?? "") : a.scheduledAt.localeCompare(b.scheduledAt));
    return tasks.map((t) => taskOut(t, leads)) as T;
  }
  if (method === "GET" && path === "/tasks/summary") {
    const leads = allLeads(s);
    const tasks = demoTasks(s).filter((t) => leads.some((l) => l.id === t.leadId && (!q.get("ownerId") || l.ownerId === q.get("ownerId"))));
    return {
      overdue: tasks.filter((t) => inBucket(t, "overdue")).length,
      today: tasks.filter((t) => inBucket(t, "today")).length,
      upcoming: tasks.filter((t) => inBucket(t, "upcoming")).length,
    } as T;
  }
  if (method === "POST" && path === "/tasks") {
    const tasks = demoTasks(s);
    const lead = allLeads(s).find((l) => l.id === b.leadId);
    if (!lead) throw new DemoNotFound("Lead não encontrado");
    const task: DemoTask = {
      id: `demo-task-${Date.now()}`, leadId: lead.id, type: String(b.type || "call"), note: String(b.note || ""),
      scheduledAt: String(b.scheduledAt), done: false, doneAt: null, createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    const when = new Date(task.scheduledAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    logActivity(s, lead.id, "task_created", `${TASK_PT[task.type]} em ${when}: ${task.note}`, lead.activities);
    saveState(s);
    return taskOut(task, allLeads(s)) as T;
  }
  if (method === "PATCH" && (m = path.match(/^\/tasks\/([^/]+)$/))) {
    const task = demoTasks(s).find((t) => t.id === m![1]);
    if (!task) throw new DemoNotFound("Tarefa não encontrada");
    if (b.done !== undefined) {
      if (b.done && !task.done) {
        const lead = allLeads(s).find((l) => l.id === task.leadId);
        logActivity(s, task.leadId, "task_done", `${TASK_PT[task.type] ?? "Tarefa"} concluída: ${task.note}`, lead?.activities);
      }
      task.done = !!b.done;
      task.doneAt = task.done ? new Date().toISOString() : null;
    }
    if (b.note !== undefined) task.note = String(b.note);
    if (b.scheduledAt !== undefined) task.scheduledAt = String(b.scheduledAt);
    if (b.type !== undefined) task.type = String(b.type);
    saveState(s);
    return taskOut(task, allLeads(s)) as T;
  }
  if (method === "DELETE" && (m = path.match(/^\/tasks\/([^/]+)$/))) {
    s.tasks = demoTasks(s).filter((t) => t.id !== m![1]);
    saveState(s);
    return { ok: true } as T;
  }
  if (method === "GET" && path === "/workspace/members") {
    return [{ id: "demo-member", role: "owner", createdAt: "2026-09-20T12:00:00.000Z", user: { ...DEMO_SESSION.user, image: null } }] as T;
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
      pipelineValue: leads.filter((l) => l.crmStatus !== "won" && l.crmStatus !== "lost").reduce((sum, l) => sum + (l.dealValue ?? 0), 0),
      wonValue: leads.filter((l) => l.crmStatus === "won").reduce((sum, l) => sum + (l.dealValue ?? 0), 0),
      crmPipeline: pipeline,
    } as T;
  }
  if (method === "GET" && path === "/analytics/industries") {
    const groups = new Map<string, CrmLead[]>();
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
      [l.name, l.address, l.phone, l.email, l.website, l.rating, l.reviewCount, l.score, PRIORITY_LABELS[l.priority], CRM_STATUS_LABELS[l.crmStatus], l.campaign?.name ?? "Cadastro manual"].map(esc).join(","),
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
