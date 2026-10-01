"use client";

import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageCircle, Mail, Send, Webhook, Plug, ArrowRight, Zap } from "lucide-react";
import Link from "next/link";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

const integrations = [
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "Envie mensagens de WhatsApp diretamente para leads pelo Prospex. Abordagem com um clique usando conteúdo gerado por IA.",
    icon: MessageCircle,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    status: "coming_soon",
    category: "Mensagens",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Envie e-mails para leads diretamente pelo Prospex usando sua conta do Gmail. Rastreamento e follow-up completos.",
    icon: Mail,
    color: "text-red-500",
    bg: "bg-red-500/10",
    status: "coming_soon",
    category: "E-mail",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Receba notificações em tempo real quando campanhas forem concluídas ou leads mudarem de status.",
    icon: Send,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    status: "coming_soon",
    category: "Notificações",
  },
  {
    id: "webhook",
    name: "Webhook",
    description: "Envie dados de leads para qualquer endpoint HTTP. Conecte ao Zapier, n8n, Make ou ao seu próprio backend.",
    icon: Webhook,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    status: "coming_soon",
    category: "Automação",
  },
  {
    id: "zapier",
    name: "Zapier",
    description: "Conecte o Prospex a mais de 6.000 apps. Automatize o follow-up de leads, a sincronização com o CRM e muito mais.",
    icon: Zap,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    status: "coming_soon",
    category: "Automação",
  },
  {
    id: "n8n",
    name: "n8n",
    description: "Fluxos de automação auto-hospedados. Crie pipelines poderosos com os leads do Prospex.",
    icon: Plug,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    status: "coming_soon",
    category: "Automação",
  },
];

const categories = [...new Set(integrations.map((i) => i.category))];

export function IntegrationsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrações</h1>
          <p className="text-muted-foreground mt-1">Conecte o Prospex às ferramentas e fluxos de trabalho que você já usa</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/settings">
            Configurar chaves de IA <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* API Keys callout */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-4 py-4">
          <div className="p-2 bg-gradient-brand rounded-lg flex-shrink-0 shadow-glow">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Use a API REST do Prospex</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Acesse todos os seus leads e campanhas via código. Gere chaves de API em Configurações.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" variant="outline" asChild>
              <a href={`${(process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api").replace(/\/api\/?$/, "")}/api/docs`} target="_blank" rel="noreferrer">
                Documentação Swagger
              </a>
            </Button>
            <Button size="sm" asChild variant="gradient">
              <Link href="/settings">Chaves de API</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {categories.map((category) => (
        <div key={category}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {category}
          </h2>
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            {integrations
              .filter((i) => i.category === category)
              .map((integration) => (
                <motion.div key={integration.id} variants={item}>
                  <Card interactive className="relative overflow-hidden h-full">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${integration.bg} flex-shrink-0`}>
                            <integration.icon className={`w-5 h-5 ${integration.color}`} />
                          </div>
                          <div>
                            <CardTitle className="text-sm">{integration.name}</CardTitle>
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                          Em breve
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <CardDescription className="text-xs leading-relaxed">
                        {integration.description}
                      </CardDescription>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
          </motion.div>
        </div>
      ))}

      <p className="text-xs text-muted-foreground text-center pt-4">
        Quer uma integração?{" "}
        <a
          href="https://github.com/asiifdev/business-leads-ai-automation/issues"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          Solicite no GitHub
        </a>
      </p>
    </div>
  );
}
