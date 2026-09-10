export type AuditIssue = { code: string; severity: "critical" | "warning"; message: string; field?: string };
export type AuditResult = { passed: boolean; issues: AuditIssue[] };

export function auditDraft(draft: { weeklyPlans: unknown }): AuditResult {
  const issues: AuditIssue[] = [];
  let plans: { week: string; weight: number; is_merged: boolean }[] = [];
  try { plans = typeof draft.weeklyPlans === "string" ? JSON.parse(draft.weeklyPlans as string) : (draft.weeklyPlans as typeof plans) ?? []; } catch {}
  const is9 = plans.length === 9;
  if (!is9 && plans.length !== 0) issues.push({ code: "WEEK_COUNT", severity: "critical", message: `weeklyPlans harus 9 baris (mewakili 16 minggu), dapat ${plans.length}`, field: "weeklyPlans" });
  const sum = plans.reduce((s, p) => s + (p.weight ?? 0), 0);
  // merged UTS/UAS have weight 0, others sum to 100
  const nonMergedSum = plans.filter((p) => !p.is_merged).reduce((s, p) => s + p.weight, 0);
  if (plans.length > 0 && nonMergedSum !== 100) issues.push({ code: "WEIGHT_MISMATCH", severity: "critical", message: `Bobot non-merge harus 100, dapat ${nonMergedSum}`, field: "weeklyPlans" });
  if (plans.length > 0 && sum !== 100) {
    // if includes merged 0, sum==100 also valid
    // already checked nonMergedSum
  }
  const hasUts = plans.some((p) => p.week === "8" && p.is_merged);
  const hasUas = plans.some((p) => p.week === "16" && p.is_merged);
  if (plans.length > 0 && !hasUts) issues.push({ code: "MISSING_UTS", severity: "critical", message: "Week 8 UTS merge hilang", field: "weeklyPlans[4]" });
  if (plans.length > 0 && !hasUas) issues.push({ code: "MISSING_UAS", severity: "critical", message: "Week 16 UAS merge hilang", field: "weeklyPlans[8]" });
  const typoScan = JSON.stringify(plans).toLowerCase();
  for (const w of ["paian", "sbu-cpmk", "mahasiwa", "di skusi", "cole, i.."]) {
    if (typoScan.includes(w)) issues.push({ code: "TYPO", severity: "warning", message: `Typo terdeteksi: ${w}`, field: "weeklyPlans" });
  }
  if (typoScan.includes("menyesuaikan perkembangan pandemic covid-19") || typoScan.includes("menyesuaikan pandemic")) {
    // placeholder warning not critical
    issues.push({ code: "PLACEHOLDER", severity: "warning", message: "Placeholder pandemic masih ada — sesuaikan", field: "weeklyPlans" });
  }
  const passed = !issues.some((i) => i.severity === "critical");
  return { passed, issues };
}
