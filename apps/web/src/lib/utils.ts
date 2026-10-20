import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number): string {
  if (n >= 1000) return (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
  return n.toLocaleString("pt-BR");
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("pt-BR", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function formatCurrency(value: number | null | undefined, compact = false): string {
  if (value == null) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    ...(compact && value >= 10_000 ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: value % 1 ? 2 : 0 }),
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "2026-11-30" (input type=date) → ISO ao meio-dia de Brasília, para não "voltar um dia" ao exibir. */
export function dateInputToIso(value: string): string | null {
  return value ? new Date(`${value}T12:00:00-03:00`).toISOString() : null;
}

export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** ISO → valor de <input type="datetime-local"> no fuso do navegador. */
export function isoToDateTimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
