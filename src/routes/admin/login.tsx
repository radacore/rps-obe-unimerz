import { createFileRoute } from "@tanstack/react-router";
import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/VStack";
import { AdminLoginForm } from "@/components/AdminLoginForm";

export const Route = createFileRoute("/admin/login")({
  component: () => (
    <VStack gap={4}>
      <Heading level={1}>Login Admin</Heading>
      <AdminLoginForm />
    </VStack>
  ),
});
