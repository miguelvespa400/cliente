import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { SettingsService } from "../settings/settings.service";

export interface GenerateContentInput {
  businessName: string;
  address?: string;
  industry: string;
  rating?: string;
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

@Injectable()
export class MarketingAiService {
  private readonly logger = new Logger(MarketingAiService.name);
  private openai: OpenAI | null = null;

  constructor(
    private config: ConfigService,
    private settings: SettingsService,
  ) {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (apiKey) {
      this.openai = new OpenAI({
        apiKey,
        baseURL: this.config.get<string>("OPENAI_BASE_URL") || undefined,
      });
    }
  }

  // Prioridade: chave cadastrada em Configurações → Integrações (por workspace),
  // depois OPENAI_API_KEY do servidor, e por fim o conteúdo-modelo (sem custo).
  private async resolveClient(workspaceId?: string): Promise<{ client: OpenAI; model: string } | null> {
    const ws = workspaceId ? await this.settings.getOpenAiConfig(workspaceId).catch(() => null) : null;
    if (ws) {
      return {
        client: new OpenAI({ apiKey: ws.apiKey, baseURL: ws.baseURL }),
        model: ws.model || this.config.get<string>("OPENAI_MODEL") || "gpt-4o-mini",
      };
    }
    if (this.openai) return { client: this.openai, model: this.config.get<string>("OPENAI_MODEL") || "gpt-4o-mini" };
    return null;
  }

  async generateContent(input: GenerateContentInput, workspaceId?: string): Promise<MarketingContent> {
    const resolved = await this.resolveClient(workspaceId);
    if (!resolved) return this.generateMockContent(input);
    try {
      return await this.callOpenAI(input, resolved.client, resolved.model);
    } catch (err) {
      this.logger.error("OpenAI generation failed, using mock content", err);
      return this.generateMockContent(input);
    }
  }

  private async callOpenAI(input: GenerateContentInput, client: OpenAI, model: string): Promise<MarketingContent> {
    const languageNames: Record<string, string> = {
      portuguese: "Brazilian Portuguese (pt-BR)",
      english: "English",
      spanish: "Spanish",
      indonesian: "Indonesian (Bahasa Indonesia)",
    };
    const languageName = languageNames[input.language] || languageNames.portuguese;
    const styleCues: Record<string, string> = {
      professional: "formal, professional, direct",
      friendly: "warm, friendly, approachable",
      casual: "casual, relaxed, conversational",
      balanced: "balanced, friendly yet professional",
    };
    const style = styleCues[input.contentStyle] || "balanced";

    const prompt = `Generate personalized outreach content for this business lead.

Business: ${input.businessName}
Industry: ${input.industry}
Address: ${input.address || "unknown"}
Rating: ${input.rating || "unknown"} stars
Has Website: ${input.hasWebsite ? "yes" : "no"}
Your Service/Product: ${input.yourService}
Tone: ${style}
Language: ${languageName} — write ALL content in this language
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

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });
    return JSON.parse(response.choices[0].message.content!) as MarketingContent;
  }

  generateMockContent(input: GenerateContentInput): MarketingContent {
    const isId = input.language === "indonesian";
    const name = input.businessName;
    const service = input.yourService;
    const ratingTag = input.rating ? ` dengan rating ${input.rating} bintang` : "";
    const ratingTagEn = input.rating ? ` with a ${input.rating}-star rating` : "";

    if (input.language === "portuguese" || !input.language) {
      const ratingTagPt = input.rating ? ` com avaliação ${input.rating}⭐` : "";
      return {
        email: {
          subject: `${name}: mais clientes com ${service}`,
          body: `Olá, equipe ${name}!\n\nConheci o trabalho de vocês${input.rating ? ` e vi a avaliação de ${input.rating} estrelas no Google` : ""} — parabéns!\n\nQueria mostrar como ${service} pode ajudar a ${name} a atrair mais clientes e crescer com mais previsibilidade.\n\nVocês teriam 15 minutos esta semana para uma conversa rápida?\n\nAbraço,\n[Seu nome]`,
        },
        whatsapp: `Olá, ${name}! 👋\n\nVi o perfil de vocês no Google${ratingTagPt} — muito bom!\n\nPosso mostrar em 2 minutos como ${service} pode ajudar a ${name} a crescer? 🚀`,
        instagram: `Oi, ${name}! Curti muito o trabalho de vocês${ratingTagPt} 🔥 Tenho uma ideia de como ${service} pode trazer mais clientes para vocês. Posso te mandar? ✨`,
        linkedin: { connectionNote: `Olá! Conheci a ${name} e gostaria de me conectar. Trabalho com ${service} e vejo um bom potencial de parceria.` },
        coldCall: { opening: `Bom dia! Falo com o responsável pela ${name}? Meu nome é [Seu nome], trabalho com ${service} e queria mostrar rapidamente como podemos ajudar a ${name} a conquistar mais clientes.` },
      };
    }

    if (input.language === "spanish") {
      const ratingTagEs = input.rating ? ` con ${input.rating}⭐` : "";
      return {
        email: {
          subject: `Haz crecer ${name} con ${service}`,
          body: `Hola, equipo de ${name}:\n\nConocí su negocio${ratingTagEs} — ¡excelente trabajo!\n\nMe gustaría mostrarles cómo ${service} puede ayudar a ${name} a atraer más clientes.\n\n¿Tendrían 15 minutos para una breve llamada?\n\nSaludos,\n[Tu nombre]`,
        },
        whatsapp: `¡Hola, ${name}! 👋\n\nVi su negocio${ratingTagEs} — ¡muy bien!\n\n¿Les muestro cómo ${service} puede ayudarles a crecer? 🚀`,
        instagram: `¡Hola, ${name}! Me encanta lo que hacen${ratingTagEs} 🔥 Creo que ${service} puede llevar su negocio al siguiente nivel. ✨`,
        linkedin: { connectionNote: `Hola, conocí ${name} y me gustaría conectar. Trabajo con ${service} y veo gran potencial de colaboración.` },
        coldCall: { opening: `Buenos días, ¿hablo con el responsable de ${name}? Quisiera contarle brevemente cómo ${service} puede ayudar a ${name} a crecer.` },
      };
    }

    if (isId) {
      return {
        email: {
          subject: `Tingkatkan bisnis ${name} dengan ${service}`,
          body: `Halo tim ${name},\n\nSaya melihat bisnis Anda${ratingTag} — sangat impressive!\n\nSaya ingin berbagi bagaimana ${service} bisa membantu ${name} tumbuh lebih cepat dan melayani pelanggan lebih baik.\n\nApakah ada waktu 15 menit untuk berdiskusi?\n\nSalam,\n[Nama Anda]`,
        },
        whatsapp: `Halo ${name}! 👋\n\nSaya lihat bisnis Anda${input.rating ? ` rating ${input.rating}⭐` : ""} — keren!\n\nMau tau gimana ${service} bisa bantu ${name} makin berkembang? 🚀\n\nBoleh chat sebentar?`,
        instagram: `Hi ${name}! Bisnis kalian${input.rating ? ` rating ${input.rating}⭐` : ""} keren banget 🔥 Penasaran gimana ${service} bisa bantu bisnis kalian makin sukses. Yuk DM! ✨`,
        linkedin: { connectionNote: `Halo, saya tertarik dengan ${name}. Saya bergerak di bidang ${service} dan ingin berdiskusi tentang potensi kolaborasi.` },
        coldCall: { opening: `Selamat pagi, boleh berbicara dengan pemilik ${name}? Saya ingin berbagi bagaimana ${service} bisa membantu pertumbuhan ${name}.` },
      };
    }

    return {
      email: {
        subject: `Grow ${name} with ${service}`,
        body: `Hi ${name} team,\n\nI came across your business${ratingTagEn} — impressive work!\n\nI'd love to share how ${service} could help ${name} serve more customers and grow faster.\n\nWould you have 15 minutes for a quick chat?\n\nBest,\n[Your Name]`,
      },
      whatsapp: `Hi ${name}! 👋\n\nSaw your business${input.rating ? ` rated ${input.rating}⭐` : ""} — great work!\n\nWant to see how ${service} can help ${name} grow? 🚀\n\nQuick chat?`,
      instagram: `Hi ${name}! Love what you're doing${input.rating ? ` (${input.rating}⭐!)` : ""} 🔥 I think ${service} could take your business to the next level. DM me! ✨`,
      linkedin: { connectionNote: `Hi, I noticed ${name} and would love to connect. I specialize in ${service} and see great potential for collaboration.` },
      coldCall: { opening: `Hi, may I speak with the owner of ${name}? I'd love to share how ${service} could help grow ${name}.` },
    };
  }
}
