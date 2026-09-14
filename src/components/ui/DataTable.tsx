import { Text } from "@astryxdesign/core/Text";

/**
 * Tabel data ringan untuk daftar (draft RPS, matrix CPL, dsb).
 *
 * Astryx belum menyediakan komponen tabel di paket `core`; wrapper ini
 * menstandarkan gaya tabel HTML (border, padding, header emphasis) supaya
 * seluruh aplikasi memakai gaya yang sama alih-alih tiap panel menulis
 * ulang kelas Tailwind. Bila Astryx menambahkan `Table` di kemudian hari,
 * hanya berkas ini yang perlu diubah.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  emptyLabel = "Belum ada data.",
  minWidth,
}: {
  rows: T[];
  columns: {
    header: string;
    /** Rendering satu sel; kembalikan node/string. */
    cell: (row: T, index: number) => React.ReactNode;
    /** Rata sel — default kiri. */
    align?: "left" | "center" | "right";
    /** Lebar tetap (px atau %) supaya kolom sempit tidak melar. */
    width?: string | number;
  }[];
  rowKey: (row: T, index: number) => React.Key;
  emptyLabel?: string;
  /** Minimal lebar tabel supaya scroll-x bila viewport sempit. */
  minWidth?: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-6 text-center">
        <Text type="supporting">{emptyLabel}</Text>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        style={minWidth ? { minWidth } : undefined}
      >
        <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
          <tr>
            {columns.map((col) => (
              <th
                key={col.header}
                className="border-b border-border px-3 py-2"
                style={{
                  width: col.width, textAlign: col.align ?? "left",
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b border-border/60 last:border-0">
              {columns.map((col) => (
                <td
                  key={col.header}
                  className="px-3 py-2 align-top"
                  style={{ textAlign: col.align ?? "left" }}
                >
                  {col.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
