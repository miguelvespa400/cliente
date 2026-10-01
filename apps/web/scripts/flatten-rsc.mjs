// Pós-processamento do export estático (demo no GitHub Pages).
// O Next grava os payloads de prefetch por segmento em subpastas
// (ex.: campaigns/__next.!X/campaigns/__PAGE__.txt), mas o cliente os pede com
// nomes "achatados" (campaigns/__next.!X.campaigns.__PAGE__.txt). Sem servidor
// Next para reescrever a URL, criamos as cópias com o nome que o navegador pede.
import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve(process.argv[2] ?? "out");
let copies = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("__next.")) flatten(full, dir, entry.name);
    else walk(full);
  }
}

function flatten(segmentDir, pageDir, prefix) {
  for (const entry of fs.readdirSync(segmentDir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath ?? entry.path, entry.name);
    const rel = path.relative(segmentDir, abs).split(path.sep).join(".");
    const target = path.join(pageDir, `${prefix}.${rel}`);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(abs, target);
      copies++;
    }
  }
}

walk(outDir);
console.log(`flatten-rsc: ${copies} arquivos criados em ${outDir}`);
