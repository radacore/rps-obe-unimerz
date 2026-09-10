import { Banner as AstryxBanner } from "@astryxdesign/core/Banner";
import type { BannerStatus } from "@astryxdesign/core/Banner";
export function Banner({ status = "info", title, children }: { status?: BannerStatus; title?: string; children: React.ReactNode }) {
  return <AstryxBanner status={status} title={title ?? ""} collapsible={false}>{children}</AstryxBanner>;
}
