import { createFileRoute } from "@tanstack/react-router";
import { AdminLoginForm } from "@/components/AdminLoginForm";

// Halaman login memakai layout `Center` bawaan Astryx yang menempatkan
// kartunya di tengah viewport. Heading halaman ("Login Admin") dihilangkan
// karena kartu sudah punya judul "Selamat datang kembali" di dalamnya.
export const Route = createFileRoute("/admin/login")({
  component: AdminLoginForm,
});
