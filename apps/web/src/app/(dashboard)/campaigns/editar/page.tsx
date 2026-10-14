"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CreateCampaignForm } from "@/components/campaigns/create-campaign-form";
import { useCampaign } from "@/hooks/use-campaigns";

// Mesmo esquema do detalhe (?id=) para funcionar no export estático do GitHub Pages.
function EditCampaign({ id }: { id: string }) {
  const { campaign, loading } = useCampaign(id);
  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!campaign) return <p className="text-sm text-muted-foreground">Campanha não encontrada.</p>;
  if (campaign.status !== "draft") {
    return <p className="text-sm text-muted-foreground">Só é possível editar campanhas em rascunho.</p>;
  }
  return <CreateCampaignForm campaign={campaign} />;
}

function EditCampaignFromQuery() {
  const id = useSearchParams().get("id");
  if (!id) return <p className="text-sm text-muted-foreground">Campanha não informada.</p>;
  return <EditCampaign id={id} />;
}

export default function EditCampaignPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Editar campanha</h1>
        <p className="text-muted-foreground text-sm">Ajuste a configuração do rascunho antes de iniciar a coleta</p>
      </div>
      <Suspense>
        <EditCampaignFromQuery />
      </Suspense>
    </div>
  );
}
