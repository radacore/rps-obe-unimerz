import { Card as AstryxCard } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Divider } from "@astryxdesign/core/Divider";

/**
 * Kartu berjudul untuk panel isian: satu blok visual yang membungkus judul,
 * deskripsi pendek, aksi header (opsional), dan isian.
 *
 * Sebelumnya pola ini ditulis ulang di tiap panel sebagai
 * `<div className="rounded-lg border border-border bg-surface p-4">` +
 * `<Text weight="semibold">...</Text>`. Diseragamkan agar padding, border,
 * dan hierarki heading konsisten di seluruh aplikasi tanpa perlu ingat
 * kelas Tailwind.
 */
export function Panel({
  title,
  description,
  actions,
  headingLevel = 3,
  padding = 4,
  children,
}: {
  title?: string;
  description?: string;
  /** Slot kanan atas untuk tombol/badge — mis. "Tambah butir", "Test". */
  actions?: React.ReactNode;
  /** Level heading untuk aksesibilitas — sesuaikan dengan hierarki halaman. */
  headingLevel?: 2 | 3 | 4;
  padding?: 2 | 3 | 4 | 5;
  children: React.ReactNode;
}) {
  const hasHeader = !!(title || description || actions);
  return (
    <AstryxCard padding={padding}>
      <VStack gap={3}>
        {hasHeader && (
          <>
            <HStack justify="between" align="start" gap={3}>
              <VStack gap={1}>
                {title && <Heading level={headingLevel}>{title}</Heading>}
                {description && <Text type="supporting">{description}</Text>}
              </VStack>
              {actions && <div>{actions}</div>}
            </HStack>
            <Divider variant="subtle" />
          </>
        )}
        {children}
      </VStack>
    </AstryxCard>
  );
}
