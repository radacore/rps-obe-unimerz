import { createFileRoute, Link } from "@tanstack/react-router";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { DraftList } from "@/components/DraftList";

export const Route = createFileRoute("/")({
  component: () => (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading level={1}>RPS OBE Generator</Heading>
          <Text type="supporting">
            Dokumen RPS Universitas Megarezky, disusun bertahap lalu diterbitkan sebagai DOCX
            sesuai template resmi. Dokumen yang sudah terbit bisa diunduh tanpa login.
          </Text>
        </div>
        <Link
          to="/rps/baru"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white no-underline"
        >
          Buat RPS baru
        </Link>
      </div>
      <DraftList />
    </div>
  ),
});
