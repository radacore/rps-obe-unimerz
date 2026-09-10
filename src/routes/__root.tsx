import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
export const Route = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <AppShell><Outlet /></AppShell>
    </QueryClientProvider>
  ),
});
