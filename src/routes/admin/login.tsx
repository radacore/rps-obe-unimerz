import { createFileRoute } from "@tanstack/react-router";
import { Heading } from "@astryxdesign/core/Heading";
import { AdminLoginForm } from "@/components/AdminLoginForm";

export const Route = createFileRoute("/admin/login")({
  component: () => (
    <div className="grid gap-4">
      <Heading level={1}>Login Admin</Heading>
      <AdminLoginForm />
    </div>
  ),
});
