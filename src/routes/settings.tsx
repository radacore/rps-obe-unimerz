import { createFileRoute } from "@tanstack/react-router";
import { SettingsPanel } from "@/components/SettingsPanel";
export const Route = createFileRoute("/settings")({ component: () => (
  <div className="grid gap-4">
    <h1 className="text-xl font-semibold text-slate-900">Settings — BYOK</h1>
    <SettingsPanel />
  </div>
)});
