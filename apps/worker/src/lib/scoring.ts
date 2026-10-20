// Pontuação de leads — mesma lógica de apps/api/src/ai/lead-intelligence.service.ts.

export interface RawLead {
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: string;
  reviewCount?: number | null;
  hasWebsite?: boolean;
}

const INDUSTRY_SCORES: Record<string, number> = {
  restaurant: 85, cafe: 90, retail: 75, automotive: 80, healthcare: 85,
  beauty: 80, education: 75, realestate: 85, event: 80, tech: 90,
  professional: 85, hotel: 80, spa: 78, gym: 75,
};

export function scoreLead(lead: RawLead, industry: string) {
  let score = 50;
  const factors: string[] = [];

  if (lead.phone) { score += 10; factors.push("Tem telefone"); }
  if (lead.hasWebsite) { score += 10; factors.push("Tem site"); }
  if (lead.address) { score += 5; factors.push("Tem endereço"); }

  const rawRating = parseFloat(lead.rating ?? "0");
  if (rawRating > 0) {
    // Média bayesiana: puxa a nota para 4,0★ com peso de 25 avaliações, para um 5★
    // com 1 avaliação não passar na frente de um 4,5★ com milhares.
    const n = lead.reviewCount ?? 1;
    const rating = (25 * 4.0 + n * rawRating) / (25 + n);
    if (rating >= 4.5) score += 15;
    else if (rating >= 4.0) score += 10;
    else if (rating >= 3.5) score += 5;
    factors.push(`Nota ${rawRating}★${lead.reviewCount != null ? ` (${lead.reviewCount} avaliações)` : ""}`);
    if ((lead.reviewCount ?? 0) >= 100) { score += 5; factors.push("Bem estabelecido (100+ avaliações)"); }
    else if ((lead.reviewCount ?? 0) >= 20) { score += 2; factors.push("Estabelecido (20+ avaliações)"); }
  }

  const industryScore = INDUSTRY_SCORES[industry.toLowerCase().replace(/[^a-z]/g, "")];
  if (industryScore) score += (industryScore - 50) / 5;

  if (!lead.hasWebsite) { score += 5; factors.push("Sem site próprio (oportunidade digital)"); }

  score = Math.min(100, Math.max(0, Math.round(score)));
  const priority = score >= 75 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW";
  const recommendation =
    priority === "HIGH" ? "Alto potencial. Priorize a abordagem."
    : priority === "MEDIUM" ? "Potencial moderado. Inclua na sequência padrão."
    : "Prioridade baixa. Contate se houver capacidade.";
  return { score, priority, factors, recommendation };
}
