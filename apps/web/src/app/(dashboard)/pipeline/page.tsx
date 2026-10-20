import { PipelineBoard } from "@/components/crm/pipeline-board";

export default function PipelinePage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Funil de vendas</h1>
        <p className="text-muted-foreground">Arraste os cards entre as etapas ou use o menu ⋯ de cada card</p>
      </div>
      <PipelineBoard />
    </div>
  );
}
