// Gera o painel (apps/web) como site estático para o Worker servir em ../web/out.
// API no mesmo domínio (/api), sem modo demonstração e sem basePath.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// Usa o pnpm global (CI) ou, se não houver, o mesmo pnpm via npx.
let pnpm = "pnpm";
try { execSync("pnpm --version", { stdio: "ignore" }); } catch { pnpm = "npx --yes pnpm@9.14.4"; }

rmSync(new URL("../web/out", import.meta.url), { recursive: true, force: true });
execSync(`${pnpm} --filter @prospex/web build`, {
  stdio: "inherit",
  env: {
    ...process.env,
    STATIC_EXPORT: "true",
    NEXT_PUBLIC_API_URL: "/api",
    NEXT_PUBLIC_BASE_PATH: "",
    NEXT_PUBLIC_DEMO_MODE: "false",
  },
});
execSync("node scripts/flatten-rsc.mjs out", { stdio: "inherit", cwd: new URL("../web", import.meta.url) });
