import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import "./workspace.css";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <DashboardShell>{children}</DashboardShell>;
}
