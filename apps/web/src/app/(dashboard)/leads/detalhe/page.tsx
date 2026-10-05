"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LeadDetail } from "@/components/leads/lead-detail";

// Detalhe por query string (?id=) em vez de /leads/[id]: funciona também no
// export estático do GitHub Pages, onde IDs criados depois do build não têm página.
function LeadDetailFromQuery() {
  const id = useSearchParams().get("id");
  if (!id) return <p className="text-sm text-muted-foreground">Lead não informado.</p>;
  return <LeadDetail id={id} />;
}

export default function LeadDetailPage() {
  return (
    <Suspense>
      <LeadDetailFromQuery />
    </Suspense>
  );
}
