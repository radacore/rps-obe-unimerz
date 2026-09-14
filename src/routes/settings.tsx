import { createFileRoute } from "@tanstack/react-router";
import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/VStack";
import { SettingsPanel } from "@/components/SettingsPanel";

export const Route = createFileRoute("/settings")({
  component: () => (
    <VStack gap={4}>
      <Heading level={1}>Settings — BYOK</Heading>
      <SettingsPanel />
    </VStack>
  ),
});
