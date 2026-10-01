// Dados FICTÍCIOS do modo demonstração (NEXT_PUBLIC_DEMO_MODE=true).
// Módulo puro (sem window/localStorage) para poder ser usado também em generateStaticParams.
// Nomes, telefones, e-mails e sites são inventados — domínios usam ".exemplo.com.br".

export const DEMO_NEW_CAMPAIGN_ID = "demo-nova";
export const DEMO_NEW_LEAD_COUNT = 8;

interface CampaignSeed {
  id: string;
  name: string;
  industry: string;
  location: string;
  searchQueries: string[];
  yourService: string;
  contentStyle: string;
  createdAt: string;
  center: [number, number];
  street: string[];
  categories: string[];
  businesses: string[];
}

const SEEDS: CampaignSeed[] = [
  {
    id: "demo-dentistas-curitiba",
    name: "Dentistas — Curitiba",
    industry: "healthcare",
    location: "Curitiba, PR",
    searchQueries: ["dentista batel", "clínica odontológica água verde"],
    yourService: "Gestão de tráfego pago para clínicas odontológicas",
    contentStyle: "professional",
    createdAt: "2026-09-22T13:10:00.000Z",
    center: [-25.4411, -49.2766],
    street: ["Av. do Batel", "R. Comendador Araújo", "Av. Sete de Setembro", "R. Bispo Dom José", "Av. República Argentina"],
    categories: ["Dentista", "Clínica odontológica", "Ortodontista", "Implantodontista"],
    businesses: [
      "Sorriso Pleno Odontologia", "Clínica Odonto Batel Prime", "Dente de Leão Odontopediatria",
      "Instituto Arco Ortodontia", "Odonto Água Verde", "Clínica Raiz Implantes",
      "Studio Smile Estética Dental", "Odontologia Integrada Araucária", "Clínica Bem Sorrir",
      "Centro Odontológico Sete", "OdontoVida Família", "Implanta Curitiba",
    ],
  },
  {
    id: "demo-restaurantes-floripa",
    name: "Restaurantes — Florianópolis",
    industry: "restaurant",
    location: "Florianópolis, SC",
    searchQueries: ["restaurante lagoa da conceição", "frutos do mar centro florianópolis"],
    yourService: "Criação de cardápio digital e site com pedidos online",
    contentStyle: "friendly",
    createdAt: "2026-09-26T17:40:00.000Z",
    center: [-27.5954, -48.548],
    street: ["Av. das Rendeiras", "R. Henrique Veras", "Av. Beira-Mar Norte", "R. Esteves Júnior", "R. Laurindo Januário da Silveira"],
    categories: ["Restaurante", "Restaurante de frutos do mar", "Pizzaria", "Bistrô"],
    businesses: [
      "Maré Alta Frutos do Mar", "Cantina da Lagoa", "Bistrô Ilha Bela", "Pizzaria Forno Açoriano",
      "Rancho do Pescador", "Sabor de Sambaqui", "Casa Ostra Viva", "Tempero Manezinho",
      "Quintal da Beira-Mar", "Empório Lagoa Gourmet",
    ],
  },
  {
    id: "demo-saloes-bh",
    name: "Salões de beleza — Belo Horizonte",
    industry: "beauty",
    location: "Belo Horizonte, MG",
    searchQueries: ["salão de beleza savassi", "studio de unhas funcionários"],
    yourService: "Sistema de agendamento online com lembretes por WhatsApp",
    contentStyle: "casual",
    createdAt: "2026-09-29T12:05:00.000Z",
    center: [-19.9386, -43.9346],
    street: ["R. Pernambuco", "Av. Getúlio Vargas", "R. Antônio de Albuquerque", "R. Tomé de Souza", "Av. do Contorno"],
    categories: ["Salão de beleza", "Esmalteria", "Barbearia", "Estúdio de sobrancelhas"],
    businesses: [
      "Studio Lumière Beauty", "Esmalteria Cor & Arte", "Salão Bella Savassi", "Barbearia Dom Bigode",
      "Espaço Glamour Funcionários", "Studio Olhar Sobrancelhas", "Casa da Beleza Mineira", "Salão Raízes Cachos",
    ],
  },
];

// Gerador pseudoaleatório determinístico (mesmos dados a cada carregamento).
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);

const STYLE_GREETING: Record<string, string> = {
  professional: "Bom dia",
  friendly: "Oi",
  casual: "E aí",
  balanced: "Olá",
};

export function demoMarketingContent(name: string, service: string, rating: string, style: string, city: string) {
  const hi = STYLE_GREETING[style] ?? "Olá";
  const stars = rating !== "N/A" ? ` e a avaliação de ${rating} estrelas no Google` : "";
  return {
    email: {
      subject: `${name}: mais clientes com ${service.toLowerCase()}`,
      body:
        `${hi}, equipe ${name}!\n\nConheci o trabalho de vocês aqui em ${city}${stars} — parabéns pelo atendimento.\n\n` +
        `Trabalho com ${service.toLowerCase()} e vejo uma oportunidade clara para a ${name} atrair mais clientes nos próximos meses.\n\n` +
        `Vocês teriam 15 minutos esta semana para eu mostrar um diagnóstico rápido, sem compromisso?\n\nAbraço,\n[Seu nome]`,
    },
    whatsapp:
      `${hi}, ${name}! 👋\n\nVi o perfil de vocês no Google${rating !== "N/A" ? ` (${rating}⭐)` : ""} — muito bom!\n\n` +
      `Posso te mostrar em 2 minutos como ${service.toLowerCase()} pode trazer mais clientes para vocês? 🚀`,
    instagram: `${hi}, ${name}! Curti muito o trabalho de vocês 🔥 Tenho uma ideia de ${service.toLowerCase()} que pode trazer mais clientes. Posso te mandar? ✨`,
    linkedin: {
      connectionNote: `Olá! Conheci a ${name} e gostaria de me conectar. Trabalho com ${service.toLowerCase()} em ${city} e vejo um bom potencial de parceria.`,
    },
    coldCall: {
      opening: `${hi}! Falo com o responsável pela ${name}? Meu nome é [Seu nome], trabalho com ${service.toLowerCase()} e queria mostrar rapidamente como podemos ajudar vocês a conquistar mais clientes.`,
    },
  };
}

// Categoria do Google Maps de cada empresa fictícia.
const DEMO_CATEGORIES: Record<string, string> = {
  "Sorriso Pleno Odontologia": "Dentista",
  "Clínica Odonto Batel Prime": "Clínica odontológica",
  "Dente de Leão Odontopediatria": "Odontopediatra",
  "Instituto Arco Ortodontia": "Ortodontista",
  "Odonto Água Verde": "Clínica odontológica",
  "Clínica Raiz Implantes": "Implantodontista",
  "Studio Smile Estética Dental": "Dentista",
  "Odontologia Integrada Araucária": "Clínica odontológica",
  "Clínica Bem Sorrir": "Clínica odontológica",
  "Centro Odontológico Sete": "Clínica odontológica",
  "OdontoVida Família": "Dentista",
  "Implanta Curitiba": "Implantodontista",
  "Maré Alta Frutos do Mar": "Restaurante de frutos do mar",
  "Cantina da Lagoa": "Restaurante italiano",
  "Bistrô Ilha Bela": "Bistrô",
  "Pizzaria Forno Açoriano": "Pizzaria",
  "Rancho do Pescador": "Restaurante de frutos do mar",
  "Sabor de Sambaqui": "Restaurante",
  "Casa Ostra Viva": "Restaurante de frutos do mar",
  "Tempero Manezinho": "Restaurante",
  "Quintal da Beira-Mar": "Bar e restaurante",
  "Empório Lagoa Gourmet": "Empório",
  "Studio Lumière Beauty": "Salão de beleza",
  "Esmalteria Cor & Arte": "Esmalteria",
  "Salão Bella Savassi": "Salão de beleza",
  "Barbearia Dom Bigode": "Barbearia",
  "Espaço Glamour Funcionários": "Salão de beleza",
  "Studio Olhar Sobrancelhas": "Estúdio de sobrancelhas",
  "Casa da Beleza Mineira": "Salão de beleza",
  "Salão Raízes Cachos": "Salão especializado em cachos"
};

const CRM_SPREAD = ["new", "new", "new", "contacted", "new", "replied", "contacted", "meeting", "new", "won", "proposal", "lost"];

export interface DemoCampaignInput {
  id: string;
  name: string;
  industry: string;
  location: string;
  searchQueries: string[];
  yourService: string;
  contentStyle: string;
  createdAt: string;
  center?: [number, number];
  street?: string[];
  categories?: string[];
  businesses?: string[];
}

const GENERIC_PREFIX = ["Studio", "Clínica", "Casa", "Espaço", "Centro", "Grupo", "Instituto", "Ateliê"];
const GENERIC_SUFFIX = ["Prime", "Central", "do Bairro", "Bem-Estar", "Mais", "Premium", "Vida", "Express"];

export function buildDemoLeads(c: DemoCampaignInput, count: number, idPrefix: string, withCrmSpread: boolean) {
  const rand = rng(c.id + c.name);
  const city = c.location.split(",")[0].trim();
  const center = c.center ?? [-23.5505, -46.6333];
  const streets = c.street ?? ["Av. Principal", "R. das Flores", "R. XV de Novembro", "Av. Brasil"];
  const categories = c.categories ?? [c.searchQueries[0] ? capitalize(c.searchQueries[0].split(" ")[0]) : "Comércio local"];
  const base = c.searchQueries[0]?.split(" ")[0] ?? "Negócio";
  const names =
    c.businesses ??
    Array.from({ length: count }, (_, i) => `${GENERIC_PREFIX[i % 8]} ${capitalize(base)} ${GENERIC_SUFFIX[(i * 3) % 8]}`);

  return names.slice(0, count).map((name, i) => {
    const hasWebsite = rand() > 0.35;
    const hasEmail = hasWebsite && rand() > 0.4;
    const reviewCount = Math.round(3 + rand() * rand() * 420);
    const rating = (3.6 + rand() * 1.4).toFixed(1);
    const domain = `${slug(name)}.exemplo.com.br`;

    let score = 42;
    const factors: string[] = ["Tem telefone"];
    score += 8;
    if (hasEmail) { score += 6; factors.push("E-mail encontrado no site"); }
    if (!hasWebsite) { score += 16; factors.push("Sem site próprio (oportunidade digital)"); }
    if (reviewCount < 40) { score += 10; factors.push(`Poucas avaliações (${reviewCount}) — presença digital fraca`); }
    else if (reviewCount < 150) { score += 5; factors.push(`${reviewCount} avaliações no Google`); }
    else factors.push(`Bem estabelecido (${reviewCount} avaliações)`);
    if (Number(rating) >= 4.5) { score += 6; factors.push(`Ótima avaliação: ${rating}★`); }
    else if (Number(rating) >= 4) score += 3;
    score = Math.min(98, Math.round(score + rand() * 10));
    const priority = score >= 75 ? "HIGH" : score >= 58 ? "MEDIUM" : "LOW";

    const created = new Date(new Date(c.createdAt).getTime() + 90_000 + i * 4000).toISOString();
    return {
      id: `${idPrefix}-${i + 1}`,
      name,
      address: `${streets[i % streets.length]}, ${100 + Math.round(rand() * 1800)} — ${city}`,
      lat: center[0] + (rand() - 0.5) * 0.03,
      lng: center[1] + (rand() - 0.5) * 0.03,
      phone: `(${dddFor(c.location)}) 9${String(8000 + Math.round(rand() * 1999)).padStart(4, "0")}-${String(Math.round(rand() * 9999)).padStart(4, "0")}`,
      email: hasEmail ? `contato@${domain}` : null,
      website: hasWebsite ? `https://www.${domain}` : rand() > 0.5 ? `https://instagram.com/${slug(name)}` : "",
      rating,
      reviewCount,
      category: DEMO_CATEGORIES[name] ?? categories[i % categories.length],
      source: "google_maps",
      referenceUrl: "",
      hasWebsite,
      score,
      priority,
      aiAnalysis: {
        factors,
        recommendation:
          priority === "HIGH" ? "Alto potencial. Priorize a abordagem hoje."
          : priority === "MEDIUM" ? "Potencial moderado. Inclua na sequência padrão de abordagem."
          : "Prioridade baixa. Contate se houver capacidade.",
      },
      marketingContent: priority === "LOW" ? null : demoMarketingContent(name, c.yourService, rating, c.contentStyle, city),
      crmStatus: withCrmSpread ? CRM_SPREAD[i % CRM_SPREAD.length] : "new",
      crmNotes: null,
      campaignId: c.id,
      campaign: { id: c.id, name: c.name },
      activities: [] as Array<{ id: string; type: string; note: string; createdAt: string }>,
      scrapedAt: created,
      createdAt: created,
      updatedAt: created,
    };
  });
}

export type DemoLead = ReturnType<typeof buildDemoLeads>[number];

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dddFor(location: string) {
  const uf = location.split(",")[1]?.trim().toUpperCase();
  return ({ PR: "41", SC: "48", MG: "31", SP: "11", RJ: "21", RS: "51", BA: "71", PE: "81", CE: "85", DF: "61", GO: "62" } as Record<string, string>)[uf ?? ""] ?? "11";
}

export function buildDemoCampaign(c: DemoCampaignInput, leads: DemoLead[], status: string, progress: number) {
  const done = status === "completed";
  const counted = done ? leads : [];
  return {
    id: c.id,
    name: c.name,
    description: null,
    industry: c.industry,
    location: c.location,
    searchQueries: c.searchQueries,
    maxResults: 20,
    yourService: c.yourService,
    contentStyle: c.contentStyle,
    language: "portuguese",
    status,
    progress,
    error: null,
    startedAt: c.createdAt,
    completedAt: done ? new Date(new Date(c.createdAt).getTime() + 120_000).toISOString() : null,
    createdAt: c.createdAt,
    updatedAt: c.createdAt,
    totalLeads: counted.length,
    priorityLeads: counted.filter((l) => l.priority === "HIGH").length,
    highQualityLeads: counted.filter((l) => l.score >= 70).length,
    averageScore: counted.length ? Math.round(counted.reduce((s, l) => s + l.score, 0) / counted.length) : 0,
    workspaceId: "demo-workspace",
    _count: { leads: counted.length },
  };
}

export const DEMO_SEEDS = SEEDS;

export const DEMO_SEED_LEADS: DemoLead[] = SEEDS.flatMap((s) => buildDemoLeads(s, s.businesses.length, s.id, true));

// IDs pré-gerados no export estático (rotas dinâmicas /campaigns/[id] e /leads/[id]).
export const DEMO_CAMPAIGN_IDS = [...SEEDS.map((s) => s.id), DEMO_NEW_CAMPAIGN_ID];
export const DEMO_LEAD_IDS = [
  ...DEMO_SEED_LEADS.map((l) => l.id),
  ...Array.from({ length: DEMO_NEW_LEAD_COUNT }, (_, i) => `${DEMO_NEW_CAMPAIGN_ID}-${i + 1}`),
];
