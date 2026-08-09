import { AudioBriefing } from "@/components/AudioBriefing";
import { RiskBadge } from "@/components/RiskBadge";
import { briefingScript } from "@/lib/itinerary";
import { RISK_STYLES, SPORT_EMOJI } from "@/lib/risk-ui";
import {
  SPORT_LABELS,
  type DayConditions,
  type DayPlan,
  type GeocodedPlace,
  type SportConditions,
} from "@/lib/types";
import { cn, formatDayLabel, formatMeasure } from "@/lib/utils";

function SportConditionBlock({ conditions }: { conditions: SportConditions }) {
  return (
    <div className={cn("rounded-xl border bg-slate-950/40 p-4", RISK_STYLES[conditions.risk].ring)}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <span aria-hidden>{SPORT_EMOJI[conditions.sport]}</span>
          {SPORT_LABELS[conditions.sport]}
        </p>
        <RiskBadge risk={conditions.risk} />
      </div>

      <p className="mt-2 text-sm text-slate-300">{conditions.headline}</p>

      <dl className="mt-3 space-y-1.5">
        {conditions.metrics.map((metric) => (
          <div key={metric.key} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="shrink-0 text-slate-400">{metric.label}</dt>
            <dd className="text-right">
              <span
                className={cn(
                  "font-mono font-medium",
                  metric.risk === "unsafe"
                    ? "text-rose-300"
                    : metric.risk === "caution"
                      ? "text-amber-300"
                      : metric.risk === "safe"
                        ? "text-emerald-300"
                        : "text-slate-400",
                )}
              >
                {metric.value === null ? "—" : formatMeasure(metric.value, metric.unit)}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {conditions.dataGap ? (
        <p className="mt-3 border-t border-white/5 pt-2 text-xs text-slate-400">
          {conditions.dataGap}
        </p>
      ) : null}
    </div>
  );
}

export function DayCard({
  index,
  plan,
  conditions,
  place,
  tripId,
  prerenderedAudioUrl,
}: {
  index: number;
  plan: DayPlan;
  conditions: DayConditions;
  place: GeocodedPlace;
  tripId: string;
  prerenderedAudioUrl?: string;
}) {
  return (
    <article id={`day-${plan.date}`} className="card animate-fade-up overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 bg-white/[0.02] px-5 py-4 sm:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-tide-300">
            Day {index + 1} · {formatDayLabel(plan.date)}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-50">{plan.title}</h2>
        </div>
        <RiskBadge
          risk={conditions.overallRisk}
          label={`Overall ${conditions.overallRisk}`}
          className="mt-1"
        />
      </header>

      <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          {(
            [
              ["Morning", plan.morning],
              ["Midday", plan.midday],
              ["Evening", plan.evening],
            ] as const
          ).map(([label, text]) => (
            <section key={label}>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                {label}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-200">{text}</p>
            </section>
          ))}

          {plan.safetyNote ? (
            <p className="rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
              <span className="font-semibold text-slate-100">Why: </span>
              {plan.safetyNote}
            </p>
          ) : null}

          {plan.citedPlaces.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-slate-500">
                Real places used
              </span>
              {plan.citedPlaces.map((cited) => (
                <span
                  key={cited}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300"
                >
                  {cited}
                </span>
              ))}
            </div>
          ) : null}

          <AudioBriefing
            tripId={tripId}
            date={plan.date}
            script={briefingScript(plan, place)}
            prerenderedUrl={prerenderedAudioUrl}
          />
        </div>

        <div className="space-y-3">
          {conditions.bySport.map((sportConditions) => (
            <SportConditionBlock key={sportConditions.sport} conditions={sportConditions} />
          ))}
        </div>
      </div>
    </article>
  );
}
