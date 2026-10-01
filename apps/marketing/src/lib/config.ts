// Destino dos botões de cadastro. No GitHub Pages aponta para o repositório
// (definido no workflow); localmente, para o dashboard em localhost.
export const SIGNUP_URL = process.env.NEXT_PUBLIC_SIGNUP_URL || "http://localhost:3000/register";

// Repositório exibido nos links "GitHub"/"Docs". Projeto original: asiifdev/business-leads-ai-automation (MIT).
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/asiifdev/business-leads-ai-automation";
export const REPO_PATH = REPO_URL.replace(/^https?:\/\//, "");
