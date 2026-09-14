import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { DraftList } from "@/components/DraftList";

function BerandaPage() {
  const nav = useNavigate();
  return (
    <VStack gap={6}>
      <HStack justify="between" align="start" gap={3} wrap="wrap">
        <VStack gap={1}>
          <Heading level={1}>RPS OBE Generator</Heading>
          <Text type="supporting">
            Dokumen RPS Universitas Megarezky, disusun bertahap lalu diterbitkan sebagai DOCX
            sesuai template resmi. Dokumen yang sudah terbit bisa diunduh tanpa login.
          </Text>
        </VStack>
        <Button label="Buat RPS baru" variant="primary" onClick={() => nav({ to: "/rps/baru" })} />
      </HStack>
      <DraftList />
    </VStack>
  );
}

export const Route = createFileRoute("/")({
  component: BerandaPage,
});
