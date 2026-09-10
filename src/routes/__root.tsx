import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Theme } from "@astryxdesign/core/theme";
import { academicNavyTheme } from "@/lib/academic-navy";
import { AppShell } from "@/components/AppShell";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
export const Route = createRootRoute({
  component: () => (
    <Theme theme={academicNavyTheme}>
      <QueryClientProvider client={queryClient}>
        <AppShell><Outlet /></AppShell>
      </QueryClientProvider>
    </Theme>
  ),
});
