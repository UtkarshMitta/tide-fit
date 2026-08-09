import type { RiskLevel, Sport } from "@/lib/types";

export const RISK_LABELS: Record<RiskLevel, string> = {
  safe: "Safe",
  caution: "Caution",
  unsafe: "Unsafe",
  unknown: "No data",
};

export const RISK_STYLES: Record<RiskLevel, { badge: string; dot: string; ring: string }> = {
  safe: {
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
    dot: "bg-emerald-400",
    ring: "border-emerald-400/30",
  },
  caution: {
    badge: "bg-amber-500/15 text-amber-300 border-amber-400/30",
    dot: "bg-amber-400",
    ring: "border-amber-400/30",
  },
  unsafe: {
    badge: "bg-rose-500/15 text-rose-300 border-rose-400/30",
    dot: "bg-rose-400",
    ring: "border-rose-400/30",
  },
  unknown: {
    badge: "bg-slate-500/15 text-slate-300 border-slate-400/25",
    dot: "bg-slate-400",
    ring: "border-slate-400/25",
  },
};

export const SPORT_EMOJI: Record<Sport, string> = {
  swimming: "🌊",
  running: "🏃",
  cycling: "🚴",
  hiking: "🥾",
};
