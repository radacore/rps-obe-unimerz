import { createFileRoute } from "@tanstack/react-router";
import { Heading } from "@astryxdesign/core/Heading";
import { AdminPanel } from "@/components/AdminPanel";

export const Route = createFileRoute("/admin/")({
  component: () => (
    <div className="grid gap-4">
      <Heading level={1}>Admin — Master Data OBE</Heading>
      <AdminPanel />
    </div>
  ),
});
