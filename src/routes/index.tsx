import { createFileRoute } from "@tanstack/react-router";
import { DraftList } from "@/components/DraftList";
import { CreateRpsForm } from "@/components/CreateRpsForm";
export const Route = createFileRoute("/")({ component: () => (
  <div className="grid gap-6">
    <div>
      <h1 className="text-xl font-semibold text-slate-900">RPS OBE Generator — Simple (BYOK)</h1>
      <p className="mt-1 text-sm text-slate-600">Tanpa login. 3 langkah: Identitas → Deskripsi → Generate AI 9 baris (16 minggu) → DOCX.</p>
    </div>
    <DraftList />
    <CreateRpsForm />
  </div>
)});
