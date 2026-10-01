"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, X } from "lucide-react";
import { motion } from "framer-motion";

const INDUSTRIES = [
  { value: "restaurant", label: "Restaurantes e alimentação" },
  { value: "cafe", label: "Cafeterias" },
  { value: "retail", label: "Varejo e moda" },
  { value: "automotive", label: "Automotivo" },
  { value: "healthcare", label: "Saúde e clínicas" },
  { value: "beauty", label: "Beleza e bem-estar" },
  { value: "education", label: "Educação e cursos" },
  { value: "realestate", label: "Imobiliário" },
  { value: "event", label: "Eventos e casamentos" },
  { value: "tech", label: "Tecnologia" },
  { value: "professional", label: "Serviços profissionais" },
];

export function CreateCampaignForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [queries, setQueries] = useState<string[]>([""]);
  const [form, setForm] = useState({
    name: "",
    industry: "",
    location: "",
    yourService: "",
    maxResults: "20",
    contentStyle: "balanced",
    language: "portuguese",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const addQuery = () => setQueries((q) => [...q, ""]);
  const removeQuery = (i: number) => setQueries((q) => q.filter((_, idx) => idx !== i));
  const updateQuery = (i: number, v: string) =>
    setQueries((q) => q.map((old, idx) => (idx === i ? v : old)));

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      const campaign = await api.post<{ id: string }>("/campaigns", {
        name: form.name,
        industry: form.industry,
        location: form.location,
        searchQueries: queries.filter(Boolean),
        yourService: form.yourService,
        maxResults: Number(form.maxResults),
        contentStyle: form.contentStyle,
        language: form.language,
      });
      await api.post(`/scraper/campaigns/${campaign.id}/start`, {});
      router.push(`/campaigns/${campaign.id}`);
    } catch (err) {
      console.error("Failed to create campaign:", err);
      setLoading(false);
    }
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalhes da campanha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name">Nome da campanha</Label>
            <Input id="name" placeholder="ex.: Dentistas Curitiba 2º tri 2026" value={form.name} onChange={set("name")} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Segmento</Label>
              <Select value={form.industry} onValueChange={(v) => setForm((p) => ({ ...p, industry: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione o segmento" /></SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((i) => (
                    <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Localização</Label>
              <Input id="location" placeholder="ex.: Curitiba, PR" value={form.location} onChange={set("location")} required />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Termos de busca</Label>
              <Badge variant="secondary" className="text-xs">
                {queries.length} {queries.length === 1 ? "termo" : "termos"}
              </Badge>
            </div>
            <div className="space-y-2">
              {queries.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    data-testid="query-input"
                    placeholder={`ex.: dentistas ${form.location || "Curitiba"}`}
                    value={q}
                    onChange={(e) => updateQuery(i, e.target.value)}
                    required
                  />
                  {queries.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeQuery(i)} className="flex-shrink-0 text-muted-foreground hover:text-destructive">
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addQuery} className="text-xs mt-1">
              <Plus className="w-3 h-3 mr-1" />Adicionar termo de busca
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service">Seu serviço / produto</Label>
            <Textarea
              id="service"
              placeholder="Descreva o que você oferece a esses leads (ex.: criação de sites)..."
              value={form.yourService}
              onChange={set("yourService")}
              className="resize-none"
              rows={3}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Máximo de resultados</Label>
              <Select value={form.maxResults} onValueChange={(v) => setForm((p) => ({ ...p, maxResults: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["10", "20", "50", "100"].map((n) => (
                    <SelectItem key={n} value={n}>{n} leads</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tom do conteúdo</Label>
              <Select value={form.contentStyle} onValueChange={(v) => setForm((p) => ({ ...p, contentStyle: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Profissional</SelectItem>
                  <SelectItem value="friendly">Amigável</SelectItem>
                  <SelectItem value="balanced">Equilibrado</SelectItem>
                  <SelectItem value="casual">Descontraído</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Idioma</Label>
              <Select value={form.language} onValueChange={(v) => setForm((p) => ({ ...p, language: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="portuguese">Português</SelectItem>
                  <SelectItem value="english">Inglês</SelectItem>
                  <SelectItem value="spanish">Espanhol</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
        <CardFooter className="gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancelar</Button>
          <Button type="submit" variant="gradient" className="flex-1" disabled={loading}>
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Iniciando campanha...</>
            ) : (
              "Iniciar campanha"
            )}
          </Button>
        </CardFooter>
      </Card>
    </motion.form>
  );
}
