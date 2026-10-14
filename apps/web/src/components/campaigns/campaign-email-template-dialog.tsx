"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";

interface Template {
  subject: string;
  body: string;
}

/** Editor do texto padrão de e-mail da campanha, com reescrita por IA guiada por instruções. */
export function CampaignEmailTemplateDialog({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);

  useEffect(() => {
    api
      .get<{ template: Template | null }>(`/email/campaigns/${campaignId}/template`)
      .then((r) => {
        setSubject(r.template?.subject ?? "");
        setBody(r.template?.body ?? "");
      })
      .catch(() => toast.error("Não foi possível carregar o texto"))
      .finally(() => setLoading(false));
  }, [campaignId]);

  const generate = async () => {
    setBusy("ai");
    try {
      // Manda o texto atual junto: a IA mantém as correções feitas à mão.
      const r = await api.post<{ template: Template }>(`/email/campaigns/${campaignId}/template/generate`, {
        instructions,
        subject,
        body,
      });
      setSubject(r.template.subject);
      setBody(r.template.body);
      toast.success("Texto gerado. Revise e salve.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar com IA");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await api.put(`/email/campaigns/${campaignId}/template`, { subject, body });
      toast.success("Texto padrão salvo");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Texto padrão do e-mail</DialogTitle>
          <DialogDescription>
            Usado em todos os envios desta campanha, no lugar do texto gerado para cada lead. Use{" "}
            <code className="text-xs">{"{{empresa}}"}</code> onde entra o nome da empresa.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-subject">Assunto</Label>
              <Input id="tpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="{{empresa}}: ..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-body">Mensagem</Label>
              <Textarea id="tpl-body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Olá, equipe da {{empresa}}!\n\n..."} />
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
              <Label htmlFor="tpl-ai">Gerar com IA</Label>
              <Textarea
                id="tpl-ai"
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Ex.: mais curto, cite que atendemos imobiliárias da região de Sorocaba, chamada para uma conversa de 15 min"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <Button type="button" variant="outline" size="sm" onClick={generate} disabled={!!busy}>
                  {busy === "ai" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {subject || body ? "Reescrever com IA" : "Gerar com IA"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  A IA parte do texto acima, mantém suas correções e aplica as instruções. Nada é salvo até você clicar em Salvar.
                </span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="gradient" onClick={save} disabled={!!busy || loading || !subject.trim() || !body.trim()}>
            {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
