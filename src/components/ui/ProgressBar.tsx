import { ProgressBar as AstryxProgressBar } from "@astryxdesign/core/ProgressBar";
export function ProgressBar({ value, max = 100 }: { value: number; max?: number }) {
  const ok = value === max;
  return <AstryxProgressBar label="Progress" value={value} max={max} hasValueLabel variant={ok ? "success" : "warning"} />;
}
