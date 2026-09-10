import { useId } from "react";
import { Field as AstryxField } from "@astryxdesign/core/Field";
export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  const id = useId();
  const status = error ? ({ type: "error" as const, message: error } as const) : undefined;
  return (
    <AstryxField label={label} inputID={id} description={hint} status={status}>
      <div id={id}>{children}</div>
    </AstryxField>
  );
}
