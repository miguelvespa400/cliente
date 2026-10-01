import { LeadsList } from "@/components/leads/leads-list";

export default function LeadsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">Todos os leads das suas campanhas</p>
      </div>
      <LeadsList />
    </div>
  );
}
