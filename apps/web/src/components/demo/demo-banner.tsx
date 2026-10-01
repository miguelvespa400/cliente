import { IS_DEMO } from "@/lib/demo";

// Faixa fixa no topo do painel quando o build é a demonstração estática.
export function DemoBanner() {
  if (!IS_DEMO) return null;
  return (
    <div className="bg-primary/10 border-b border-primary/20 px-4 py-2 text-center text-xs sm:text-sm text-foreground">
      <strong>Modo demonstração</strong> — empresas e contatos são fictícios. Na versão instalada, as campanhas buscam
      empresas reais no Google Maps e a IA escreve as mensagens.
    </div>
  );
}
