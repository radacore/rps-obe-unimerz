import { Card as AstryxCard } from "@astryxdesign/core/Card";
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <AstryxCard padding={4} className={className}>{children}</AstryxCard>;
}
