import { createFileRoute } from "@tanstack/react-router";
import { DraftList } from "@/components/DraftList";
import { CreateRpsForm } from "@/components/CreateRpsForm";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
export const Route = createFileRoute("/")({ component: () => (
  <div className="grid gap-6">
    <div>
      <Heading level={1}>RPS OBE Generator — Simple (BYOK)</Heading>
      <Text type="supporting">Tanpa login. 3 langkah: Identitas → Deskripsi → Generate AI 9 baris (16 minggu) → DOCX.</Text>
    </div>
    <DraftList />
    <CreateRpsForm />
  </div>
)});
