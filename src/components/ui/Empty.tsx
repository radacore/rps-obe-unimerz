import { EmptyState } from "@astryxdesign/core/EmptyState";

/**
 * Empty state konsisten untuk daftar kosong (draft, audit, sub-CPMK).
 *
 * Membungkus Astryx `EmptyState` supaya semua pemakaian pakai heading level
 * yang seragam (`h4`) dan padding compact — mencegah tiap layar mengarang
 * gaya sendiri.
 */
export function Empty({
  title, description, actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      actions={actions}
      headingLevel={4}
      isCompact
    />
  );
}
