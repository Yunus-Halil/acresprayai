// NOAA condition lookup, as a labeled suggestion — never a prefilled value.
//
// The rule this exists to keep: a fetched value is NOT an observed condition.
// It is a station observation — often an airport anemometer miles from the
// field, at 10 m, not boom height over the crop — so the suggestion card
// names the station and its distance BEFORE the operator decides, the fields
// stay empty until "Use these values" is pressed, and an unaccepted
// suggestion never becomes entered data. Declining leaves everything exactly
// as manual entry.
//
// The fetched observation is reported to the parent on arrival (accepted or
// not) so the record can keep it as a model_check: condition flagging runs on
// what the station said even when the operator recorded different values.
import { useState } from "react";
import { CloudSun, Loader2 } from "lucide-react";
import {
  type ObservationSuggestion, fetchObservation, observationFailureText,
} from "@/lib/weatherObservation";

export function ConditionLookup({
  center, dateYmd, timeHm, onAccept, onFetched,
}: {
  /** Field centroid [lat, lng]; null disables the lookup. */
  center: [number, number] | null;
  dateYmd: string;
  /** Application start time "HH:MM"; empty disables with a hint. */
  timeHm: string | null;
  /** The explicit acceptance — the ONLY path by which values enter fields. */
  onAccept: (s: ObservationSuggestion) => void;
  /** Fired whenever a fetch succeeds, before any decision. */
  onFetched: (s: ObservationSuggestion) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<ObservationSuggestion | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [decided, setDecided] = useState(false);

  if (!center) return null;

  const canLookup = !!timeHm && !!dateYmd;

  const lookUp = async () => {
    if (!canLookup || busy) return;
    setBusy(true);
    setFailure(null);
    setSuggestion(null);
    setDecided(false);
    const res = await fetchObservation(center, dateYmd, timeHm!);
    setBusy(false);
    if (res.kind === "found") {
      setSuggestion(res.suggestion);
      onFetched(res.suggestion);
    } else {
      setFailure(observationFailureText(res));
    }
  };

  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });

  return (
    <div className="col-span-2 space-y-1.5">
      {!suggestion && (
        <button
          type="button"
          disabled={!canLookup || busy}
          title={canLookup
            ? "Fetch the nearest NWS station's observation for the application time. Shown as a suggestion; nothing is filled in until you accept it."
            : "Enter the application date and start time first."}
          onClick={() => void lookUp()}
          className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400 underline transition-colors hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CloudSun className="h-3 w-3" />}
          {busy ? "Looking up conditions…" : "Look up conditions (NOAA)"}
        </button>
      )}

      {failure && (
        <div className="rounded-sm border border-[#222] bg-[#0a0a0a] px-2 py-1.5 text-[10px] leading-snug text-neutral-500">
          {failure}
        </div>
      )}

      {suggestion && !decided && (
        <div
          data-testid="condition-suggestion"
          className="rounded-sm border border-sky-900/60 bg-sky-950/20 px-2.5 py-2 text-[11px] leading-relaxed"
        >
          <div className="font-medium text-sky-200">
            {suggestion.wind_mph != null && suggestion.wind_dir
              ? `Wind at ${when(suggestion.observed_at)}: ${suggestion.wind_mph} mph ${suggestion.wind_dir}`
              : `Wind at ${when(suggestion.observed_at)}: not reported`}
            {suggestion.temp_f != null ? ` · ${suggestion.temp_f} °F` : " · temperature not reported"}
          </div>
          <div className="text-[10px] text-sky-300/70">
            Source: NOAA station {suggestion.station} ({suggestion.station_name}),{" "}
            {suggestion.distance_mi.toFixed(1)} mi from the field. Station data, not conditions
            at your boom.
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => { onAccept(suggestion); setDecided(true); }}
              className="rounded-sm bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sky-500"
            >
              Use these values
            </button>
            <button
              type="button"
              onClick={() => setDecided(true)}
              className="rounded-sm border border-[#333] px-2 py-1 text-[11px] text-neutral-300 transition-colors hover:bg-[#1a1a1a]"
            >
              Enter what I observed
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ConditionLookup;
