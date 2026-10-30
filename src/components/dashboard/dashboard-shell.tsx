import { Topbar } from "@/components/dashboard/topbar";

export function DashboardShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <Topbar />
      <main id="workspace" className="page-content px-4 pb-10 pt-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
