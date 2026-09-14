import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell as AstryxAppShell } from "@astryxdesign/core/AppShell";
import { TopNav } from "@astryxdesign/core/TopNav";
import { TopNavItem } from "@astryxdesign/core/TopNav";
import { TopNavHeading } from "@astryxdesign/core/TopNav";
import { Text } from "@astryxdesign/core/Text";
import { ADMIN_SESSION_KEY, fetchAdminSession } from "@/lib/admin";

/**
 * Komponen yang dioper ke prop `as` milik TopNav agar navigasi memakai
 * TanStack Router (SPA), bukan `<a>` bawaan yang melakukan full reload.
 *
 * Dideklarasikan sebagai konstanta modul, bukan arrow function inline di
 * dalam render — kalau tidak, TopNav akan menganggap komponennya berubah tiap
 * render dan remount elemen link, kehilangan state fokus.
 */
type LinkLikeProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  target?: string;
  rel?: string;
};

function RouterLink({ href, children, ...rest }: LinkLikeProps) {
  return (
    <Link to={href as "/"} {...rest}>
      {children}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Detail RPS berisi WeeklyTable 16 baris — butuh sedikit lebih lega
  // supaya kolom nyaman dibaca. Halaman lain (Drafts, Settings, Admin, dan
  // wizard `/rps/baru`) dibatasi lebih sempit supaya fokus terasa di tengah.
  const isRpsDetail = /^\/rps\/[^/]+$/.test(pathname) && pathname !== "/rps/baru";

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

  // TopNavHeading Astryx memakai prop `heading` + `headingHref` + `as` untuk
  // membangun judul aplikasi. Pola ini dianjurkan dokumentasi karena
  // menyerahkan penataan (font, tinggi baris) ke sistem tema, sementara `as`
  // memastikan klik pada judul tetap dirouting oleh SPA.
  const topNav = (
    <TopNav
      label="Navigasi utama"
      heading={
        <TopNavHeading
          heading="RPS OBE Generator"
          headingHref="/"
          subheading="Universitas Megarezky"
          as={RouterLink}
        />
      }
      endContent={
        <>
          <TopNavItem
            label="Drafts"
            href="/"
            isSelected={pathname === "/"}
            as={RouterLink}
          />
          <TopNavItem
            label="Settings"
            href="/settings"
            isSelected={pathname === "/settings"}
            as={RouterLink}
          />
          <TopNavItem
            label="Admin"
            href={adminHref}
            isSelected={pathname.startsWith("/admin")}
            as={RouterLink}
          />
        </>
      }
    />
  );

  return (
    <AstryxAppShell variant="elevated" topNav={topNav}>
      <div className={isRpsDetail ? "mx-auto box-border w-full min-w-0 max-w-6xl px-4 py-6 xl:px-6" : "mx-auto box-border w-full min-w-0 max-w-4xl px-4 py-8 sm:px-6"}>
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
