"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IS_DEMO, ensureDemoSession } from "@/lib/demo";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Na demonstração o visitante entra direto, sem tela de login.
    if (IS_DEMO) ensureDemoSession();
    const token = localStorage.getItem("prospex_token");
    if (!token) {
      router.replace("/login");
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
