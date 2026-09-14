import { createFileRoute } from "@tanstack/react-router";
import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/VStack";
import { AdminPanel } from "@/components/AdminPanel";

export const Route = createFileRoute("/admin/")({
  component: () => (
    <VStack gap={4}>
      <Heading level={1}>Admin — Master Data OBE</Heading>
      <AdminPanel />
    </VStack>
  ),
});
