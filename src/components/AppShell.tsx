import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell as AstryxAppShell } from "@astryxdesign/core/AppShell";
import { TopNav } from "@astryxdesign/core/TopNav";
import { TopNavItem } from "@astryxdesign/core/TopNav";
import { TopNavHeading } from "@astryxdesign/core/TopNav";
import { Text } from "@astryxdesign/core/Text";
import { ADMIN_SESSION_KEY, fetchAdminSession } from "@/lib/admin";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isRpsDetail = pathname.startsWith("/rps/");

  // Sesi dipakai hanya untuk memilih tujuan tautan Admin. 401 adalah jawaban
  // yang sah ("belum login"), jadi jangan diperlakukan sebagai kegagalan.
  const session = useQuery({
    queryKey: ADMIN_SESSION_KEY,
    queryFn: fetchAdminSession,
    retry: false,
    staleTime: 60_000,
  });
  const isLoggedIn = !!session.data;
  const adminHref = isLoggedIn ? "/admin" : "/admin/login";

  return (
    <AstryxAppShell
      variant="elevated"
      topNav={
        <TopNav
          heading={<TopNavHeading> <Link to="/" style={{ color: "inherit", textDecoration: "none", fontWeight: 600 }}>RPS OBE Generator</Link></TopNavHeading>}
          endContent={
            <>
              <TopNavItem label="Drafts" href="/" isSelected={pathname === "/"} as={({ href, children: c, ...p }) => <Link to={href as "/"} {...p}>{c}</Link>} />
              <TopNavItem label="Settings" href="/settings" isSelected={pathname === "/settings"} as={({ href, children: c, ...p }) => <Link to={href as "/settings"} {...p}>{c}</Link>} />
              <TopNavItem label="Admin" href={adminHref} isSelected={pathname.startsWith("/admin")} as={({ href, children: c, ...p }) => <Link to={href as "/admin"} {...p}>{c}</Link>} />
            </>
          }
        />
      }
    >
      <div className={isRpsDetail ? "box-border w-full min-w-0 px-3 py-4 xl:px-4" : "mx-auto box-border w-full min-w-0 max-w-5xl px-4 py-6"}>
        <div className="min-w-0 w-full max-w-full">{children}</div>
        <div className="py-8 text-center">
          <Text type="supporting" color="secondary">
            Universitas Megarezky · 8 Fakultas + Pascasarjana · 37 Prodi (S1/S2/D3/D4/Profesi) · Kop surat dinamis per Fakultas/Prodi · Academic Navy #1E3A5F
          </Text>
        </div>
      </div>
    </AstryxAppShell>
  );
}
