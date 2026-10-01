"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Key, Zap, Users, Shield, Globe, Loader2, Trash2, Plus, Eye, EyeOff, Copy, Check } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";

interface ApiKey {
  id: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface NewKeyResult extends ApiKey {
  key: string;
}

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export function SettingsPage() {
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [savedWorkspace, setSavedWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null);
  const [copied, setCopied] = useState(false);

  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [openaiBase, setOpenaiBase] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingIntegration, setSavingIntegration] = useState(false);
  const [savedIntegration, setSavedIntegration] = useState(false);

  const [keyPendingDelete, setKeyPendingDelete] = useState<ApiKey | null>(null);
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState(false);

  const loadApiKeys = useCallback(async () => {
    try {
      const keys = await api.get<ApiKey[]>("/settings/api-keys");
      setApiKeys(keys);
    } catch (e) {
      console.error("Failed to load API keys:", e);
    } finally {
      setKeysLoading(false);
    }
  }, []);

  useEffect(() => { loadApiKeys(); }, [loadApiKeys]);

  useEffect(() => {
    api.get<Workspace>("/workspace")
      .then((workspace) => {
        setWorkspaceName(workspace.name);
        setWorkspaceSlug(workspace.slug);
      })
      .catch(console.error);
  }, []);

  const saveWorkspace = async () => {
    setSavingWorkspace(true);
    setWorkspaceError("");
    try {
      const updated = await api.patch<Workspace>("/workspace", {
        name: workspaceName,
        slug: workspaceSlug,
      });
      setWorkspaceName(updated.name);
      setWorkspaceSlug(updated.slug);
      setSavedWorkspace(true);
      setTimeout(() => setSavedWorkspace(false), 2000);
    } catch (e) {
      setWorkspaceError(e instanceof Error ? e.message : "Não foi possível salvar o workspace");
    } finally {
      setSavingWorkspace(false);
    }
  };

  // Load saved AI integration config
  useEffect(() => {
    api.get<Array<{ type: string; config: Record<string, string> }>>("/settings/integrations")
      .then((integrations) => {
        const openai = integrations.find((i) => i.type === "openai");
        if (openai) {
          setOpenaiKey(openai.config.apiKey ?? "");
          setOpenaiModel(openai.config.model ?? "gpt-4o-mini");
          setOpenaiBase(openai.config.baseURL ?? "");
        }
      })
      .catch(console.error);
  }, []);

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const created = await api.post<NewKeyResult>("/settings/api-keys", { name: newKeyName });
      setNewKey(created);
      setNewKeyName("");
      await loadApiKeys();
    } catch (e) {
      console.error("Failed to create API key:", e);
    } finally {
      setCreating(false);
    }
  };

  const deleteApiKey = async (id: string) => {
    try {
      await api.delete(`/settings/api-keys/${id}`);
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (e) {
      console.error("Failed to delete API key:", e);
    } finally {
      setKeyPendingDelete(null);
    }
  };

  const copyKey = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveAiIntegration = async () => {
    setSavingIntegration(true);
    try {
      await api.post("/settings/integrations", {
        type: "openai",
        name: "OpenAI / Compatible API",
        config: { apiKey: openaiKey, model: openaiModel, baseURL: openaiBase },
      });
      setSavedIntegration(true);
      setTimeout(() => setSavedIntegration(false), 2000);
    } catch (e) {
      console.error("Failed to save integration:", e);
    } finally {
      setSavingIntegration(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">Gerencie as configurações e integrações do seu workspace</p>
      </div>

      <Tabs defaultValue="workspace">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="ai">IA e chaves de API</TabsTrigger>
          <TabsTrigger value="integrations">Integrações</TabsTrigger>
          <TabsTrigger value="team">Equipe</TabsTrigger>
          <TabsTrigger value="danger" className="text-destructive data-[state=active]:text-destructive">
            Zona de perigo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workspace" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Workspace</CardTitle>
              </div>
              <CardDescription>Informações do seu workspace</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {workspaceError && (
                <div className="text-sm text-destructive">{workspaceError}</div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome do workspace</Label>
                  <Input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Slug</Label>
                  <Input value={workspaceSlug} onChange={(e) => setWorkspaceSlug(e.target.value)} />
                </div>
              </div>
              <Button variant="gradient" onClick={saveWorkspace} disabled={savingWorkspace}>
                {savingWorkspace && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {savedWorkspace ? "Salvo!" : "Salvar alterações"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="space-y-6">
          {/* AI Integration */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Configuração de IA</CardTitle>
              </div>
              <CardDescription>Configure seu provedor de IA para pontuação de leads e geração de conteúdo</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Chave de API da OpenAI</Label>
                <div className="flex gap-2">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder="sk-... ou a chave do seu provedor"
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowKey((s) => !s)}
                    className="flex-shrink-0"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Usada na geração de conteúdo com IA e na pontuação de leads</p>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Modelo</Label>
                <Input
                  placeholder="ex.: gpt-4o-mini, gemini-flash, claude-haiku"
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                />
              </div>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>URL base personalizada</Label>
                  <Badge variant="secondary" className="text-xs">Opcional (OpenRouter/Ollama)</Badge>
                </div>
                <Input
                  placeholder="ex.: http://localhost:8045/v1"
                  value={openaiBase}
                  onChange={(e) => setOpenaiBase(e.target.value)}
                />
              </div>
              <Button variant="gradient" onClick={saveAiIntegration} disabled={savingIntegration}>
                {savingIntegration ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : savedIntegration ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : null}
                {savedIntegration ? "Salvo!" : "Salvar configuração de IA"}
              </Button>
            </CardContent>
          </Card>

          {/* Prospex API Keys */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-base">Chaves de API do Prospex</CardTitle>
                </div>
              </div>
              <CardDescription>Chaves para acessar a API do Prospex a partir de ferramentas externas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* New key reveal */}
              {newKey && (
                <div className="bg-success/10 border border-success/30 rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium text-success">Nova chave criada — copie agora, ela não será exibida novamente</p>
                  <div className="flex gap-2">
                    <Input value={newKey.key} readOnly className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={() => copyKey(newKey.key)}>
                      {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setNewKey(null)}>
                    Dispensar
                  </Button>
                </div>
              )}

              {/* Create new key */}
              <div className="flex gap-2">
                <Input
                  placeholder="Nome da chave (ex.: Produção, Zapier)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createApiKey()}
                />
                <Button
                  onClick={createApiKey}
                  disabled={creating || !newKeyName.trim()}
                  className="flex-shrink-0"
                  aria-label="Criar chave de API"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </Button>
              </div>

              {/* Key list */}
              {keysLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : apiKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma chave de API ainda</p>
              ) : (
                <div className="space-y-2">
                  {apiKeys.map((key) => (
                    <div key={key.id} data-testid="key-row" className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="text-sm font-medium">{key.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Criada em {formatDate(key.createdAt)}
                          {key.lastUsedAt && ` · Último uso em ${formatDate(key.lastUsedAt)}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setKeyPendingDelete(key)}
                        aria-label="Excluir chave de API"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Integrações</CardTitle>
              </div>
              <CardDescription>Conecte serviços externos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { name: "WhatsApp Business", description: "Envie mensagens de WhatsApp para leads" },
                  { name: "Gmail", description: "Envie e-mails diretamente pelo Prospex" },
                  { name: "Telegram", description: "Receba notificações pelo Telegram" },
                  { name: "Webhook", description: "Envie dados para qualquer endpoint HTTP" },
                ].map((integration) => (
                  <div key={integration.name} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{integration.name}</p>
                      <p className="text-xs text-muted-foreground">{integration.description}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">Em breve</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Membros da equipe</CardTitle>
              </div>
              <CardDescription>Convide sua equipe para colaborar</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 border rounded-lg">
                  <div className="w-8 h-8 bg-gradient-brand rounded-full flex items-center justify-center text-white text-sm font-bold">A</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Administrador</p>
                    <p className="text-xs text-muted-foreground">admin@prospex.io</p>
                  </div>
                  <Badge>Proprietário</Badge>
                </div>
                <Button variant="outline" className="w-full">
                  <Users className="mr-2 h-4 w-4" />Convidar membro da equipe
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger">
          <Card className="border-destructive/30">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-destructive" />
                <CardTitle className="text-base text-destructive">Zona de perigo</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Excluir workspace</p>
                  <p className="text-xs text-muted-foreground">Exclua permanentemente seu workspace e todos os dados</p>
                </div>
                <Button variant="destructive" size="sm" onClick={() => setConfirmDeleteWorkspace(true)}>
                  Excluir workspace
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!keyPendingDelete} onOpenChange={(open) => !open && setKeyPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir chave de API?</DialogTitle>
            <DialogDescription>
              {keyPendingDelete && (
                <>
                  Isso revogará imediatamente <strong>{keyPendingDelete.name}</strong>. Qualquer integração que use
                  esta chave deixará de funcionar. Esta ação não pode ser desfeita.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyPendingDelete(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => keyPendingDelete && deleteApiKey(keyPendingDelete.id)}>
              Excluir chave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteWorkspace} onOpenChange={setConfirmDeleteWorkspace}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir workspace?</DialogTitle>
            <DialogDescription>
              Isso excluirá permanentemente <strong>{workspaceName || "este workspace"}</strong>{" "}
              e todos os seus leads, campanhas e dados. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteWorkspace(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => setConfirmDeleteWorkspace(false)}>
              Excluir workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
