import { Link, useRouterState } from "@tanstack/react-router";
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const nav: [string,string][] = [["/","Drafts"],["/settings","Settings"]];
  return (
    <div className="min-h-screen bg-body">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-accent text-on-accent">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight text-on-accent">RPS OBE Generator</Link>
          <nav className="flex gap-1">
            {nav.map(([to,label]) => (
              <Link key={to} to={to} className={`rounded-full px-3 py-1 text-sm ${pathname===to ? "bg-surface text-primary" : "text-on-accent/90 hover:bg-overlay"}`}>{label}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 py-8 text-center text-xs text-secondary">Universitas Megarezky · Fakultas Keperawatan dan Kebidanan · S1 Keperawatan dan Profesi Ners · Academic Navy #1E3A5F — theme academic-navy (defineTheme extends neutralTheme)</footer>
    </div>
  );
}
