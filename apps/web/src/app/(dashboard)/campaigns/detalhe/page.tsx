"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";

// Detalhe por query string (?id=) em vez de /campaigns/[id]: funciona também no
// export estático do GitHub Pages, onde IDs criados depois do build não têm página.
function CampaignDetailFromQuery() {
  const id = useSearchParams().get("id");
  if (!id) return <p className="text-sm text-muted-foreground">Campanha não informada.</p>;
  return <CampaignDetail id={id} />;
}

export default function CampaignDetailPage() {
  return (
    <Suspense>
      <CampaignDetailFromQuery />
    </Suspense>
  );
}
