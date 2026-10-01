// Rótulos em português para valores de enum vindos da API.
// Os valores (chaves) continuam em inglês porque são o contrato com a API/banco.

export const CRM_STATUS_LABELS: Record<string, string> = {
  new: "Novo",
  contacted: "Contatado",
  replied: "Respondeu",
  meeting: "Reunião",
  proposal: "Proposta",
  won: "Ganho",
  lost: "Perdido",
};

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  running: "Em execução",
  completed: "Concluída",
  failed: "Falhou",
  paused: "Pausada",
};

export const PRIORITY_LABELS: Record<string, string> = {
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
};

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  crm_update: "Atualização no CRM",
};

export const INDUSTRY_LABELS: Record<string, string> = {
  restaurant: "Restaurantes e alimentação",
  cafe: "Cafeterias",
  retail: "Varejo e moda",
  automotive: "Automotivo",
  healthcare: "Saúde e clínicas",
  beauty: "Beleza e bem-estar",
  education: "Educação e cursos",
  realestate: "Imobiliário",
  event: "Eventos e casamentos",
  tech: "Tecnologia",
  professional: "Serviços profissionais",
};

export const LANGUAGE_LABELS: Record<string, string> = {
  portuguese: "Português",
  english: "Inglês",
  spanish: "Espanhol",
  indonesian: "Indonésio",
};

export function labelFor(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "";
  return map[value] ?? value;
}
