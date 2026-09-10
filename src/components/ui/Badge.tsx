import { Badge as AstryxBadge } from "@astryxdesign/core/Badge";
type BadgeVariantInput = "default" | "success" | "danger" | "warning";
const variantMap: Record<BadgeVariantInput, string> = { default: "neutral", success: "success", danger: "error", warning: "warning" };
export function Badge({ variant = "default", children }: { variant?: BadgeVariantInput; children: React.ReactNode }) {
  return <AstryxBadge variant={variantMap[variant] as never} label={children as never} />;
}
