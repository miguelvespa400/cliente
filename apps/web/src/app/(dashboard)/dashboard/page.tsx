import type { Metadata } from "next";
import { DashboardOverview } from "@/components/dashboard/overview";

export const metadata: Metadata = { title: "Painel | WishLead" };

export default function DashboardPage() {
  return <DashboardOverview />;
}
