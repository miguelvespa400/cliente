import type { Metadata } from "next";
import { CreateCampaignForm } from "@/components/campaigns/create-campaign-form";

export const metadata: Metadata = { title: "Nova campanha | Prospex" };

export default function NewCampaignPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Nova campanha</h1>
        <p className="text-muted-foreground text-sm">Configure uma campanha de prospecção de leads</p>
      </div>
      <CreateCampaignForm />
    </div>
  );
}
