"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { CrmStatus, Task } from "./use-leads";

export interface PipelineLead {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  dealValue: number | null;
  priority: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  crmStatus: CrmStatus;
  source: string;
  expectedCloseDate: string | null;
  ownerId: string | null;
  owner: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  nextTask: { id: string; type: string; note: string; scheduledAt: string } | null;
  updatedAt: string;
}

export interface PipelineStage {
  status: CrmStatus;
  count: number;
  value: number;
  leads: PipelineLead[];
}

export interface Member {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
}

export type TaskBucket = "overdue" | "today" | "upcoming" | "open" | "done";
export interface TaskSummary { overdue: number; today: number; upcoming: number }

/** Disparado depois de criar/concluir/excluir tarefa, para o contador da barra lateral se atualizar. */
export const TASKS_CHANGED = "prospex:tasks-changed";
export const notifyTasksChanged = () => window.dispatchEvent(new Event(TASKS_CHANGED));

export function usePipeline(filter: { ownerId?: string; q?: string }) {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { ownerId, q } = filter;

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (ownerId) params.set("ownerId", ownerId);
    if (q) params.set("q", q);
    try {
      const res = await api.get<{ stages: PipelineStage[] }>(`/leads/pipeline?${params}`);
      setStages(res.stages);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ownerId, q]);

  useEffect(() => { refresh(); }, [refresh]);
  return { stages, setStages, loading, error, refresh };
}

export function useTasks(filter: { status?: TaskBucket; leadId?: string; ownerId?: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const { status, leadId, ownerId } = filter;

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (leadId) params.set("leadId", leadId);
    if (ownerId) params.set("ownerId", ownerId);
    try {
      setTasks(await api.get<Task[]>(`/tasks?${params}`));
    } catch (e) {
      console.error("Falha ao carregar tarefas:", e);
    } finally {
      setLoading(false);
    }
  }, [status, leadId, ownerId]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);
  return { tasks, loading, refresh };
}

export function useTaskSummary(ownerId?: string) {
  const [summary, setSummary] = useState<TaskSummary | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSummary(await api.get<TaskSummary>(`/tasks/summary${ownerId ? `?ownerId=${ownerId}` : ""}`));
    } catch {
      setSummary(null);
    }
  }, [ownerId]);

  useEffect(() => {
    refresh();
    // Atualiza ao mexer em tarefas, ao voltar para a aba e a cada 5 min (lembrete sem recarregar a página).
    const onFocus = () => document.visibilityState === "visible" && refresh();
    window.addEventListener(TASKS_CHANGED, refresh);
    document.addEventListener("visibilitychange", onFocus);
    const timer = setInterval(refresh, 5 * 60_000);
    return () => {
      window.removeEventListener(TASKS_CHANGED, refresh);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(timer);
    };
  }, [refresh]);
  return { summary, refresh };
}

export function useMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    api.get<Member[]>("/workspace/members").then(setMembers).catch(() => setMembers([]));
  }, []);
  return members;
}
