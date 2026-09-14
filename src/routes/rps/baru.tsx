import { createFileRoute } from "@tanstack/react-router";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { RpsWizard } from "@/components/RpsWizard";

export const Route = createFileRoute("/rps/baru")({
  component: () => (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={1}>Buat RPS baru</Heading>
        <Text type="supporting">
          Lengkapi enam langkah berikut, lalu terbitkan dokumennya. Anda bebas berpindah langkah;
          tombol terbitkan aktif setelah semuanya lengkap.
        </Text>
      </VStack>
      <RpsWizard />
    </VStack>
  ),
});
