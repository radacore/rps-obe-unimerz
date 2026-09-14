import type { ReactNode } from "react";
import { Banner as AstryxBanner } from "@astryxdesign/core/Banner";
import type { BannerStatus } from "@astryxdesign/core/Banner";

/**
 * Wrapper Banner Astryx.
 *
 * Alasan wrapper ini ada: sebagian besar pemakaian di aplikasi hanya butuh
 * "status + judul + satu baris pesan". Astryx mewajibkan `title` sebagai
 * ReactNode dan menganggap `children` sebagai konten collapsible (default
 * tersembunyi lalu dibuka lewat tombol di header). Perilaku itu tidak sesuai
 * dengan cara kita memakai banner sebagai notice/inline error — pesan harus
 * langsung terlihat, tanpa tombol expand.
 *
 * Aturan pemakaian:
 * - Kalau hanya `children` yang diberikan → pakai sebagai `title` supaya
 *   pesan langsung muncul di header (satu baris berwarna sesuai status).
 * - Kalau `title` + `children` diberikan → `children` menjadi `description`
 *   (baris pendukung di header, tetap terlihat tanpa expand).
 * - Kalau memang perlu isi tambahan yang bisa disembunyikan → oper prop
 *   `details` (jadi children Astryx) dan wrapper akan mengaktifkan
 *   `collapsible`. Kalau tidak ada `details`, banner dipaksa `collapsible=false`
 *   supaya tombol toggle tidak muncul.
 */
export function Banner({
  status = "info",
  title,
  children,
  details,
  isDismissable,
  onDismiss,
}: {
  status?: BannerStatus;
  /** Judul singkat; opsional kalau hanya ada satu pesan (pakai children saja). */
  title?: ReactNode;
  /** Pesan utama — muncul di header bersama title. */
  children?: ReactNode;
  /** Konten panjang yang bisa disembunyikan (mis. daftar issue lengkap). */
  details?: ReactNode;
  isDismissable?: boolean;
  onDismiss?: () => void;
}) {
  // Kalau tidak ada judul eksplisit, jadikan children sebagai title supaya
  // pesan tunggal langsung terlihat tanpa slot description terpisah.
  const resolvedTitle: ReactNode = title ?? children ?? "";
  const description: ReactNode | undefined = title != null ? children : undefined;

  return (
    <AstryxBanner
      status={status}
      title={resolvedTitle}
      description={description}
      collapsible={details ? undefined : false}
      isDismissable={isDismissable}
      onDismiss={onDismiss}
    >
      {details}
    </AstryxBanner>
  );
}
