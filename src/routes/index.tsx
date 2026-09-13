import { createFileRoute } from "@tanstack/react-router";
import { DraftList } from "@/components/DraftList";
import { CreateRpsForm } from "@/components/CreateRpsForm";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
export const Route = createFileRoute("/")({ component: () => (
  <div className="grid gap-6">
    <div>
      <Heading level={1}>RPS OBE Generator — Simple (BYOK)</Heading>
      <Text type="supporting">Masuk sebagai dosen untuk menulis RPS: Identitas → Deskripsi → isi dari kurikulum prodi atau Generate AI 9 baris (16 minggu) → DOCX. Dokumen yang sudah terbit bisa diunduh tanpa login.</Text>
    </div>
    <DraftList />
    <CreateRpsForm />
  </div>
)});
