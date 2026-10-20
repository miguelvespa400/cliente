"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { TaskSummary } from "@/hooks/use-crm";

const KEY = "prospex_task_reminder";

/** Ao entrar no painel, avisa uma vez por dia (por aba) quantas tarefas estão atrasadas ou são para hoje. */
export function TaskReminder() {
  const router = useRouter();

  useEffect(() => {
    const today = new Date().toDateString();
    try {
      if (sessionStorage.getItem(KEY) === today) return;
      sessionStorage.setItem(KEY, today);
    } catch { /* modo privado: avisa mesmo assim */ }

    api.get<TaskSummary>("/tasks/summary").then(({ overdue, today: due }) => {
      if (!overdue && !due) return;
      const parts = [overdue && `${overdue} atrasada${overdue > 1 ? "s" : ""}`, due && `${due} para hoje`].filter(Boolean);
      const show = overdue ? toast.warning : toast.info;
      show(`Você tem ${parts.join(" e ")}`, {
        description: "Ligações, mensagens e reuniões do seu funil.",
        duration: 10_000,
        action: { label: "Ver tarefas", onClick: () => router.push("/tasks") },
      });
    }).catch(() => { /* sem tarefas/sem rede: não incomoda */ });
  }, [router]);

  return null;
}
