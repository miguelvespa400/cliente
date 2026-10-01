import path from "path";
import type { NextConfig } from "next";

// STATIC_EXPORT=true gera um site estático em out/ (usado no deploy do GitHub Pages).
// BASE_PATH é o subcaminho do Pages, ex.: "/nome-do-repo".
const isStaticExport = process.env.STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  ...(isStaticExport && {
    output: "export",
    basePath: process.env.BASE_PATH || "",
    images: { unoptimized: true },
    trailingSlash: true,
  }),
};

export default nextConfig;
