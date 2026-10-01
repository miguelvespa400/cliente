import type { Metadata } from "next";
import { LeadDetail } from "@/components/leads/lead-detail";
import { DEMO_LEAD_IDS } from "@/lib/demo-data";

// Export estático (demo) precisa conhecer os IDs; no modo servidor as rotas seguem dinâmicas.
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? DEMO_LEAD_IDS.map((id) => ({ id })) : [];
}

export const metadata: Metadata = { title: "Detalhes do lead | Prospex" };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetail id={id} />;
}
