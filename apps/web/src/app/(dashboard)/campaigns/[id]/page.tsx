import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import { DEMO_CAMPAIGN_IDS } from "@/lib/demo-data";

// Export estático (demo) precisa conhecer os IDs; no modo servidor as rotas seguem dinâmicas.
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? DEMO_CAMPAIGN_IDS.map((id) => ({ id })) : [];
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignDetail id={id} />;
}
