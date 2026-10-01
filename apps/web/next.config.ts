import path from "path";
import type { NextConfig } from "next";

// STATIC_EXPORT=true gera o painel como site estático (demonstração no GitHub Pages,
// com NEXT_PUBLIC_DEMO_MODE=true). Sem a flag, mantém o build "standalone" de produção.
const isStaticExport = process.env.STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: "export",
        basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : { output: "standalone" }),
  transpilePackages: ["@prospex/types"],
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
