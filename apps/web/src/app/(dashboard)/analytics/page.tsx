import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";

export default function AnalyticsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Análises</h1>
        <p className="text-muted-foreground">Métricas e indicadores de desempenho</p>
      </div>
      <AnalyticsDashboard />
    </div>
  );
}
