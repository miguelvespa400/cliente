"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export type CrmStatus = "new" | "contacted" | "replied" | "meeting" | "proposal" | "won" | "lost";

export interface Task {
  id: string;
  leadId: string;
  type: string;
  note: string;
  scheduledAt: string;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
  lead?: { id: string; name: string; phone: string | null; crmStatus: CrmStatus | null; ownerId: string | null; owner: { id: string; name: string } | null };
}

export interface Lead {
  id: string;
  name: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  phone: string;
  email?: string | null;
  website: string;
  rating: string;
  reviewCount?: number | null;
  score: number;
  priority: "HIGH" | "MEDIUM" | "LOW";
  crmStatus: CrmStatus;
  crmNotes?: string | null;
  hasWebsite: boolean;
  industry?: string;
  category?: string | null;
  source?: string;
  contactName?: string | null;
  dealValue?: number | null;
  expectedCloseDate?: string | null;
  ownerId?: string | null;
  owner?: { id: string; name: string } | null;
  tasks?: Task[];
  campaignId: string | null;
  campaign?: { id: string; name: string } | null;
  marketingContent?: {
    email?: { subject: string; body: string };
    whatsapp?: string;
    instagram?: string;
    linkedin?: { connectionNote: string };
    coldCall?: { opening: string };
  };
  aiAnalysis?: {
    factors?: string[];
    recommendation?: string;
  };
  activities?: Array<{ id: string; type: string; note: string; createdAt: string }>;
  scrapedAt: string;
  createdAt: string;
}

interface PaginatedLeads {
  data: Lead[];
  total: number;
  page: number;
  limit: number;
}

interface LeadFilter {
  campaignId?: string;
  q?: string;
  priority?: string;
  status?: string;
  ownerId?: string;
  page?: number;
  limit?: number;
}

export function useLeads(filter: LeadFilter = {}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { campaignId, q, priority, status, ownerId, page = 1, limit = 50 } = filter;

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (campaignId) params.set("campaignId", campaignId);
      if (q) params.set("q", q);
      if (priority) params.set("priority", priority);
      if (status) params.set("status", status);
      if (ownerId) params.set("ownerId", ownerId);
      params.set("page", String(page));
      params.set("limit", String(limit));

      const result = await api.get<PaginatedLeads>(`/leads?${params}`);
      setLeads(result.data);
      setTotal(result.total);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [campaignId, q, priority, status, ownerId, page, limit]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);
  return { leads, total, loading, error, refresh };
}

export function useLead(id: string) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Recarrega sem voltar ao skeleton (ações na página atualizam o lead "por baixo").
  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Lead>(`/leads/${id}`);
      setLead(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);
  return { lead, loading, error, refresh, setLead };
}
