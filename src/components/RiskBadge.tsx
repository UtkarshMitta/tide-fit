import { RISK_LABELS, RISK_STYLES } from "@/lib/risk-ui";
import type { RiskLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

export function RiskBadge({
  risk,
  label,
  className,
}: {
  risk: RiskLevel;
  label?: string;
  className?: string;
}) {
  const styles = RISK_STYLES[risk];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
        styles.badge,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", styles.dot)} aria-hidden />
      {label ?? RISK_LABELS[risk]}
    </span>
  );
}
