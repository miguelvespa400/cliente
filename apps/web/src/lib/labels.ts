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
  crm_update: "Mudança de etapa",
  whatsapp_sent: "WhatsApp enviado",
  email_sent: "E-mail enviado",
  email_replied: "Respondeu o e-mail",
  email_unsubscribed: "Descadastrou-se dos e-mails",
  lead_created: "Lead cadastrado",
  deal_updated: "Negócio atualizado",
  task_created: "Tarefa agendada",
  task_done: "Tarefa concluída",
};

/** Etapas do funil, na ordem das colunas do Kanban. */
export const CRM_STAGES: Array<{ status: string; label: string; dot: string }> = [
  { status: "new", label: "Novo", dot: "bg-slate-400" },
  { status: "contacted", label: "Contatado", dot: "bg-sky-500" },
  { status: "replied", label: "Respondeu", dot: "bg-indigo-500" },
  { status: "meeting", label: "Reunião", dot: "bg-amber-500" },
  { status: "proposal", label: "Proposta", dot: "bg-orange-500" },
  { status: "won", label: "Ganho", dot: "bg-emerald-500" },
  { status: "lost", label: "Perdido", dot: "bg-rose-500" },
];

export const TASK_TYPE_LABELS: Record<string, string> = {
  call: "Ligar",
  whatsapp: "WhatsApp",
  email: "E-mail",
  meeting: "Reunião",
  visit: "Visita",
  other: "Outro",
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
