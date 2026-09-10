import { Link, useRouterState } from "@tanstack/react-router";
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const nav: [string,string][] = [["/","Drafts"],["/settings","Settings"]];
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b bg-[#1E3A5F] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight">RPS OBE Generator</Link>
          <nav className="flex gap-1">
            {nav.map(([to,label]) => (
              <Link key={to} to={to} className={`rounded-full px-3 py-1 text-sm ${pathname===to ? "bg-white text-[#1E3A5F]" : "text-white/90 hover:bg-white/10"}`}>{label}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 py-8 text-center text-xs text-slate-500">Universitas Megarezky · Fakultas Keperawatan dan Kebidanan · S1 Keperawatan dan Profesi Ners · Academic Navy #1E3A5F</footer>
    </div>
  );
}
