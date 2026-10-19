// Mensagens de abordagem — mesma lógica de apps/api/src/ai/marketing-ai.service.ts:
// chave da OpenAI (ou compatível: OpenRouter, etc.) cadastrada no workspace; sem chave,
// conteúdo-modelo determinístico.

export interface ContentInput {
  businessName: string;
  address?: string | null;
  industry: string;
  rating?: string | null;
  hasWebsite?: boolean;
  yourService: string;
  contentStyle: string;
  language: string;
  score: number;
}

export interface MarketingContent {
  email: { subject: string; body: string };
  whatsapp: string;
  instagram: string;
  linkedin: { connectionNote: string };
  coldCall: { opening: string };
}

export interface AiConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

const LANGUAGES: Record<string, string> = {
  portuguese: "Brazilian Portuguese (pt-BR)",
  english: "English",
  spanish: "Spanish",
  indonesian: "Indonesian (Bahasa Indonesia)",
};

const STYLES: Record<string, string> = {
  professional: "formal, professional, direct",
  friendly: "warm, friendly, approachable",
  casual: "casual, relaxed, conversational",
  balanced: "balanced, friendly yet professional",
};

export async function generateContent(input: ContentInput, ai: AiConfig | null): Promise<MarketingContent> {
  if (!ai?.apiKey) return mockContent(input);
  try {
    return await callAi(input, ai);
  } catch (err) {
    console.warn("Geração por IA falhou, usando modelo pronto:", err);
    return mockContent(input);
  }
}

async function callAi(input: ContentInput, ai: AiConfig): Promise<MarketingContent> {
  const prompt = `Generate personalized outreach content for this business lead.

Business: ${input.businessName}
Industry: ${input.industry}
Address: ${input.address || "unknown"}
Rating: ${input.rating || "unknown"} stars
Has Website: ${input.hasWebsite ? "yes" : "no"}
Your Service/Product: ${input.yourService}
Tone: ${STYLES[input.contentStyle] ?? STYLES.balanced}
Language: ${LANGUAGES[input.language] ?? LANGUAGES.portuguese} — write ALL content in this language
AI Score: ${input.score}/100

Generate: email (subject + body, 100-150 words), WhatsApp (50-80 words, can use emoji), Instagram DM (40-60 words), LinkedIn connection note (under 280 chars), cold call opening (2-3 sentences).

Be specific to this business. Mention their name, rating, location.

Respond ONLY with valid JSON:
{
  "email": { "subject": "...", "body": "..." },
  "whatsapp": "...",
  "instagram": "...",
  "linkedin": { "connectionNote": "..." },
  "coldCall": { "opening": "..." }
}`;

  const base = (ai.baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ai.model || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`IA HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  // Alguns modelos (ex.: gratuitos do OpenRouter) devolvem o JSON dentro de texto/markdown.
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as MarketingContent;
  if (!parsed.whatsapp || !parsed.email?.body) throw new Error("Resposta da IA incompleta");
  return parsed;
}

export function mockContent(input: ContentInput): MarketingContent {
  const name = input.businessName;
  const service = input.yourService;
  if (input.language === "english") {
    const tag = input.rating ? ` with a ${input.rating}-star rating` : "";
    return {
      email: { subject: `Grow ${name} with ${service}`, body: `Hi ${name} team,\n\nI came across your business${tag} — impressive work!\n\nI'd love to share how ${service} could help ${name} serve more customers and grow faster.\n\nWould you have 15 minutes for a quick chat?\n\nBest,\n[Your Name]` },
      whatsapp: `Hi ${name}! 👋\n\nSaw your business${input.rating ? ` rated ${input.rating}⭐` : ""} — great work!\n\nWant to see how ${service} can help ${name} grow? 🚀`,
      instagram: `Hi ${name}! Love what you're doing 🔥 I think ${service} could take your business to the next level. ✨`,
      linkedin: { connectionNote: `Hi, I noticed ${name} and would love to connect. I specialize in ${service} and see great potential for collaboration.` },
      coldCall: { opening: `Hi, may I speak with the owner of ${name}? I'd love to share how ${service} could help grow ${name}.` },
    };
  }
  if (input.language === "spanish") {
    const tag = input.rating ? ` con ${input.rating}⭐` : "";
    return {
      email: { subject: `Haz crecer ${name} con ${service}`, body: `Hola, equipo de ${name}:\n\nConocí su negocio${tag} — ¡excelente trabajo!\n\nMe gustaría mostrarles cómo ${service} puede ayudar a ${name} a atraer más clientes.\n\n¿Tendrían 15 minutos para una breve llamada?\n\nSaludos,\n[Tu nombre]` },
      whatsapp: `¡Hola, ${name}! 👋\n\nVi su negocio${tag} — ¡muy bien!\n\n¿Les muestro cómo ${service} puede ayudarles a crecer? 🚀`,
      instagram: `¡Hola, ${name}! Me encanta lo que hacen${tag} 🔥 Creo que ${service} puede llevar su negocio al siguiente nivel. ✨`,
      linkedin: { connectionNote: `Hola, conocí ${name} y me gustaría conectar. Trabajo con ${service} y veo gran potencial de colaboración.` },
      coldCall: { opening: `Buenos días, ¿hablo con el responsable de ${name}? Quisiera contarle brevemente cómo ${service} puede ayudar a ${name} a crecer.` },
    };
  }
  const tag = input.rating ? ` com avaliação ${input.rating}⭐` : "";
  return {
    email: {
      subject: `${name}: mais clientes com ${service}`,
      body: `Olá, equipe ${name}!\n\nConheci o trabalho de vocês${input.rating ? ` e vi a avaliação de ${input.rating} estrelas no Google` : ""} — parabéns!\n\nQueria mostrar como ${service} pode ajudar a ${name} a atrair mais clientes e crescer com mais previsibilidade.\n\nVocês teriam 15 minutos esta semana para uma conversa rápida?\n\nAbraço,\n[Seu nome]`,
    },
    whatsapp: `Olá, ${name}! 👋\n\nVi o perfil de vocês no Google${tag} — muito bom!\n\nPosso mostrar em 2 minutos como ${service} pode ajudar a ${name} a crescer? 🚀`,
    instagram: `Oi, ${name}! Curti muito o trabalho de vocês${tag} 🔥 Tenho uma ideia de como ${service} pode trazer mais clientes para vocês. Posso te mandar? ✨`,
    linkedin: { connectionNote: `Olá! Conheci a ${name} e gostaria de me conectar. Trabalho com ${service} e vejo um bom potencial de parceria.` },
    coldCall: { opening: `Bom dia! Falo com o responsável pela ${name}? Meu nome é [Seu nome], trabalho com ${service} e queria mostrar rapidamente como podemos ajudar a ${name} a conquistar mais clientes.` },
  };
}
