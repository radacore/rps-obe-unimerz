import { Link, useRouterState } from "@tanstack/react-router";
import { AppShell as AstryxAppShell } from "@astryxdesign/core/AppShell";
import { TopNav } from "@astryxdesign/core/TopNav";
import { TopNavItem } from "@astryxdesign/core/TopNav";
import { TopNavHeading } from "@astryxdesign/core/TopNav";
import { Text } from "@astryxdesign/core/Text";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
            </>
          }
        />
      }
    >
      <div className="mx-auto box-border w-full min-w-0 max-w-5xl px-4 py-6">
        <div className="min-w-0 w-full max-w-full">{children}</div>
        <div className="py-8 text-center">
          <Text type="supporting" color="secondary">
            Universitas Megarezky · Fakultas Keperawatan dan Kebidanan · S1 Keperawatan dan Profesi Ners · Academic Navy #1E3A5F
          </Text>
        </div>
      </div>
    </AstryxAppShell>
  );
}
