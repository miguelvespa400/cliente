// Agrupa leads da mesma empresa: basta nome, telefone OU e-mail coincidir.
// O Google Maps devolve a mesma empresa em buscas diferentes com endereço escrito
// de outro jeito, então nome+endereço não basta.

export interface DedupeFields {
  name: string;
  phone?: string | null;
  email?: string | null;
}

export function normalizeName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  // Ignora o DDI 55 para "+55 41 9999-9999" e "(41) 9999-9999" baterem.
  const local = digits.length > 11 && digits.startsWith("55") ? digits.slice(2) : digits;
  return local.length >= 8 ? local : "";
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function dedupeKeys(lead: DedupeFields): string[] {
  const keys: string[] = [];
  const name = normalizeName(lead.name);
  const phone = normalizePhone(lead.phone);
  const email = normalizeEmail(lead.email);
  if (name) keys.push(`n:${name}`);
  if (phone) keys.push(`p:${phone}`);
  if (email) keys.push(`e:${email}`);
  return keys;
}

/**
 * Agrupa por qualquer chave em comum (transitivo: A=B pelo telefone e B=C pelo nome
 * caem no mesmo grupo) e funde cada grupo num único lead — o primeiro do grupo,
 * completado com os campos vazios preenchidos pelos demais.
 */
export function dedupeLeads<T extends DedupeFields>(leads: T[]): T[] {
  const parent = leads.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<string, number>();

  leads.forEach((lead, i) => {
    for (const key of dedupeKeys(lead)) {
      const j = owner.get(key);
      if (j === undefined) owner.set(key, i);
      else parent[find(i)] = find(j);
    }
  });

  const groups = new Map<number, T>();
  leads.forEach((lead, i) => {
    const root = find(i);
    const merged = groups.get(root);
    if (!merged) {
      groups.set(root, { ...lead });
      return;
    }
    for (const [k, v] of Object.entries(lead) as [keyof T, T[keyof T]][]) {
      const current = merged[k];
      if ((current === undefined || current === null || current === "" || current === "N/A") && v !== undefined && v !== null && v !== "") {
        merged[k] = v;
      }
    }
  });
  return [...groups.values()];
}
