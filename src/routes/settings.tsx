import { createFileRoute } from "@tanstack/react-router";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Heading } from "@astryxdesign/core/Heading";
export const Route = createFileRoute("/settings")({ component: () => (
  <div className="grid gap-4">
    <Heading level={1}>Settings — BYOK</Heading>
    <SettingsPanel />
  </div>
)});
