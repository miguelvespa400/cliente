import Link from "next/link";
import { Github } from "lucide-react";
import { REPO_URL } from "@/lib/config";

export function Footer() {
  return (
    <footer className="border-t border-white/5 py-12 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-gradient-brand rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-[10px]">P</span>
          </div>
          <span className="text-white font-semibold text-sm">Prospex</span>
          <span className="text-slate-600 text-xs">— Open-source AI GTM Platform</span>
        </div>
        <div className="flex items-center gap-6 text-slate-500 text-xs">
          <Link
            href={REPO_URL}
            target="_blank"
            className="hover:text-white transition-colors flex items-center gap-1"
          >
            <Github className="w-3.5 h-3.5" />GitHub
          </Link>
          <span>MIT License</span>
          <span>© 2026 Prospex</span>
        </div>
      </div>
    </footer>
  );
}
