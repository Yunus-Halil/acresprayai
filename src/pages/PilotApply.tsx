import { useMemo, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/landing/Wordmark";
import { PILOT_BADGE } from "@/components/landing/copy";
import { submitApplication } from "@/lib/pilotApply";
import {
  ACREAGE_RANGES,
  AVAILABILITIES,
  BOUNDARY_ANSWERS,
  DRONE_STATUSES,
  EMPTY,
  ROLES,
  showsDroneModel,
  validate,
} from "@/lib/pilotApplication";
import Seo from "@/components/Seo";

type Values = Record<string, string>;
type Errors = Partial<Record<string, string>>;

// --- form primitives, styled to the landing page ----------------------------

const inputClass = (invalid: boolean) =>
  [
    // 16px so iOS does not zoom the viewport when a field takes focus, and tall
    // enough to hit with a thumb - this form gets filled in standing in a field.
    "w-full rounded border bg-sw-card px-3.5 py-3 text-base text-sw-ink",
    "outline-none transition-colors placeholder:text-sw-faint",
    invalid ? "border-sw-error focus:border-sw-error" : "border-sw-rule focus:border-sw-green",
  ].join(" ");

const Field = ({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) => (
  <div>
    <label htmlFor={id} className="block text-[15px] font-medium text-sw-ink">
      {label}
      {required ? (
        <span className="text-sw-green" aria-hidden="true">
          {" *"}
        </span>
      ) : (
        <span className="ml-2 font-plex text-[11px] tracking-[0.08em] text-sw-faint">OPTIONAL</span>
      )}
    </label>
    {hint && <p className="mt-1 text-[13px] leading-snug text-sw-muted">{hint}</p>}
    <div className="mt-2">{children}</div>
    {/* Announced politely so a screen reader hears the message as it appears,
        rather than only when the whole form is submitted. */}
    <p
      id={`${id}-error`}
      role={error ? "alert" : undefined}
      className={`font-plex text-[11px] tracking-[0.06em] text-sw-error ${error ? "mt-2" : "sr-only"}`}
    >
      {error ?? ""}
    </p>
  </div>
);

const Section = ({ num, title, children }: { num: string; title: string; children: ReactNode }) => (
  <section className="border-t-2 border-sw-ink pt-6">
    <h2 className="font-plex text-xs tracking-[0.1em] text-sw-green">
      {num} · {title}
    </h2>
    <div className="mt-6 grid gap-6">{children}</div>
  </section>
);

// --- page -------------------------------------------------------------------

export default function PilotApply() {
  const [values, setValues] = useState<Values>({ ...EMPTY });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const allErrors = useMemo(() => ({ ...validate(values), ...serverErrors }), [values, serverErrors]);

  /** Only surface an error once the applicant has actually been to the field. */
  const shown = (name: string) => (touched[name] ? allErrors[name] : undefined);

  const set = (name: string) => (value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    // A server-side complaint about this field is stale the moment it changes.
    setServerErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  };
  const blur = (name: string) => () => setTouched((t) => ({ ...t, [name]: true }));

  const wantsDroneModel = showsDroneModel(values.drone_status);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const errors = validate(values);
    if (Object.keys(errors).length) {
      // Reveal everything now: the applicant has asked to be done, so holding
      // back the errors they haven't visited yet would just hide the work left.
      setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])));
      const first = document.getElementById(Object.keys(errors)[0]);
      first?.focus();
      first?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    setSubmitting(true);
    const result = await submitApplication(values);
    setSubmitting(false);

    if (!result.ok) {
      setServerErrors(result.errors ?? {});
      setFormError(result.message);
      return;
    }

    setDone(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-sw-paper font-grotesk text-sw-ink">
      <Seo
        title="Apply to the SwathWise pilot — 10 farms, free usage"
        description="Ten farms, free usage, this season. Tell us about your land and what you fly — it takes about two minutes."
        path="/apply"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.045]"
        style={{
          backgroundImage:
            "linear-gradient(#141712 1px, transparent 1px), linear-gradient(90deg, #141712 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "linear-gradient(to bottom, black 0, black 520px, transparent 900px)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0, black 520px, transparent 900px)",
        }}
      />

      <div className="relative mx-auto max-w-[760px] px-5 py-8 sm:px-10 sm:py-10">
        <a href="/" className="inline-flex items-center gap-2.5">
          <Wordmark />
          <span className="font-plex text-[11px] tracking-[0.08em] text-sw-faint">PRECISION AG</span>
        </a>

        {done ? <Confirmation /> : (
          <>
            <div className="mt-12 inline-flex items-center gap-2.5 rounded-[3px] border border-sw-rule bg-sw-card px-3.5 py-1.5 font-plex text-[11px] tracking-[0.04em] text-[#40483c] sm:text-xs">
              <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-sw-bright" />
              {PILOT_BADGE}
            </div>

            <h1 className="mt-6 text-[clamp(34px,6vw,52px)] font-semibold leading-[1.02] tracking-[-0.03em]">
              Apply to the pilot.
            </h1>
            <p className="mt-4 max-w-[560px] text-[17px] leading-[1.55] text-sw-muted">
              Ten farms, free usage, this season. Tell us about your land and what you fly — it
              takes about two minutes, and we read every one.
            </p>

            <form onSubmit={onSubmit} noValidate className="mt-12 grid gap-12">
              <Section num="01" title="CONTACT">
                <div className="grid gap-6 sm:grid-cols-2">
                  <Field id="full_name" label="Full name" required error={shown("full_name")}>
                    <input
                      id="full_name"
                      name="full_name"
                      autoComplete="name"
                      value={values.full_name}
                      onChange={(e) => set("full_name")(e.target.value)}
                      onBlur={blur("full_name")}
                      aria-invalid={!!shown("full_name")}
                      aria-describedby="full_name-error"
                      className={inputClass(!!shown("full_name"))}
                    />
                  </Field>

                  <Field id="email" label="Email" required error={shown("email")}>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={values.email}
                      onChange={(e) => set("email")(e.target.value)}
                      onBlur={blur("email")}
                      aria-invalid={!!shown("email")}
                      aria-describedby="email-error"
                      className={inputClass(!!shown("email"))}
                    />
                  </Field>

                  <Field id="phone" label="Phone" error={shown("phone")}>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={values.phone}
                      onChange={(e) => set("phone")(e.target.value)}
                      onBlur={blur("phone")}
                      className={inputClass(!!shown("phone"))}
                    />
                  </Field>

                  <Field id="farm_name" label="Farm or operation name" required error={shown("farm_name")}>
                    <input
                      id="farm_name"
                      name="farm_name"
                      autoComplete="organization"
                      value={values.farm_name}
                      onChange={(e) => set("farm_name")(e.target.value)}
                      onBlur={blur("farm_name")}
                      aria-invalid={!!shown("farm_name")}
                      aria-describedby="farm_name-error"
                      className={inputClass(!!shown("farm_name"))}
                    />
                  </Field>
                </div>

                <Field id="role" label="Your role" required error={shown("role")}>
                  <select
                    id="role"
                    name="role"
                    value={values.role}
                    onChange={(e) => set("role")(e.target.value)}
                    onBlur={blur("role")}
                    aria-invalid={!!shown("role")}
                    aria-describedby="role-error"
                    className={inputClass(!!shown("role"))}
                  >
                    <option value="">Select…</option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </Field>
              </Section>

              <Section num="02" title="THE LAND">
                <Field
                  id="location"
                  label="Location"
                  required
                  hint="City or county and state. We don't need a precise address at this stage."
                  error={shown("location")}
                >
                  <input
                    id="location"
                    name="location"
                    value={values.location}
                    onChange={(e) => set("location")(e.target.value)}
                    onBlur={blur("location")}
                    aria-invalid={!!shown("location")}
                    aria-describedby="location-error"
                    className={inputClass(!!shown("location"))}
                  />
                </Field>

                <Field id="acreage_range" label="Approximate acreage" required error={shown("acreage_range")}>
                  <select
                    id="acreage_range"
                    name="acreage_range"
                    value={values.acreage_range}
                    onChange={(e) => set("acreage_range")(e.target.value)}
                    onBlur={blur("acreage_range")}
                    aria-invalid={!!shown("acreage_range")}
                    aria-describedby="acreage_range-error"
                    className={inputClass(!!shown("acreage_range"))}
                  >
                    <option value="">Select…</option>
                    {ACREAGE_RANGES.map((a) => (
                      <option key={a} value={a}>{a} acres</option>
                    ))}
                  </select>
                </Field>

                <Field
                  id="crops"
                  label="Primary crops"
                  required
                  hint="Comma-separated is fine."
                  error={shown("crops")}
                >
                  <input
                    id="crops"
                    name="crops"
                    value={values.crops}
                    onChange={(e) => set("crops")(e.target.value)}
                    onBlur={blur("crops")}
                    aria-invalid={!!shown("crops")}
                    aria-describedby="crops-error"
                    className={inputClass(!!shown("crops"))}
                  />
                </Field>

                <Field
                  id="has_boundary_survey"
                  label="Do you have a field boundary or GPS survey of this land?"
                  error={shown("has_boundary_survey")}
                >
                  <select
                    id="has_boundary_survey"
                    name="has_boundary_survey"
                    value={values.has_boundary_survey}
                    onChange={(e) => set("has_boundary_survey")(e.target.value)}
                    onBlur={blur("has_boundary_survey")}
                    className={inputClass(!!shown("has_boundary_survey"))}
                  >
                    <option value="">Select…</option>
                    {BOUNDARY_ANSWERS.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </Field>
              </Section>

              <Section num="03" title="EQUIPMENT AND TIMING">
                <Field
                  id="drone_status"
                  label="Do you or your operation own a drone?"
                  required
                  error={shown("drone_status")}
                >
                  <select
                    id="drone_status"
                    name="drone_status"
                    value={values.drone_status}
                    onChange={(e) => set("drone_status")(e.target.value)}
                    onBlur={blur("drone_status")}
                    aria-invalid={!!shown("drone_status")}
                    aria-describedby="drone_status-error"
                    className={inputClass(!!shown("drone_status"))}
                  >
                    <option value="">Select…</option>
                    {DRONE_STATUSES.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </Field>

                {/* Only asked of applicants who have spraying hardware. */}
                {wantsDroneModel && (
                  <Field id="drone_model" label="Spray drone make and model" error={shown("drone_model")}>
                    <input
                      id="drone_model"
                      name="drone_model"
                      placeholder="e.g. DJI Agras T40"
                      value={values.drone_model}
                      onChange={(e) => set("drone_model")(e.target.value)}
                      onBlur={blur("drone_model")}
                      className={inputClass(!!shown("drone_model"))}
                    />
                  </Field>
                )}

                <Field id="availability" label="When could you start?" required error={shown("availability")}>
                  <select
                    id="availability"
                    name="availability"
                    value={values.availability}
                    onChange={(e) => set("availability")(e.target.value)}
                    onBlur={blur("availability")}
                    aria-invalid={!!shown("availability")}
                    aria-describedby="availability-error"
                    className={inputClass(!!shown("availability"))}
                  >
                    <option value="">Select…</option>
                    {AVAILABILITIES.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </Field>

                <Field id="referral_source" label="How did you hear about SwathWise?" error={shown("referral_source")}>
                  <input
                    id="referral_source"
                    name="referral_source"
                    value={values.referral_source}
                    onChange={(e) => set("referral_source")(e.target.value)}
                    onBlur={blur("referral_source")}
                    className={inputClass(!!shown("referral_source"))}
                  />
                </Field>

                <Field id="notes" label="Anything else we should know?" error={shown("notes")}>
                  <textarea
                    id="notes"
                    name="notes"
                    rows={5}
                    value={values.notes}
                    onChange={(e) => set("notes")(e.target.value)}
                    onBlur={blur("notes")}
                    className={`${inputClass(!!shown("notes"))} resize-y`}
                  />
                </Field>
              </Section>

              <div>
                {formError && (
                  <p role="alert" className="mb-4 font-plex text-xs tracking-[0.06em] text-sw-error">
                    {formError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2.5 rounded bg-sw-green px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-sw-green-deep disabled:opacity-60"
                >
                  {submitting ? "Sending…" : "Submit application"}
                  <span className="font-plex" aria-hidden="true">→</span>
                </button>
                <p className="mt-4 font-plex text-[11px] leading-relaxed tracking-[0.06em] text-sw-faint">
                  YOUR DETAILS STAY IN OUR DATABASE. WE DO NOT SELL OR SHARE THEM.
                </p>
              </div>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

const Confirmation = () => (
  <div className="mt-16 max-w-[560px] border-l-2 border-sw-bright pl-6">
    <div className="font-plex text-xs tracking-[0.1em] text-sw-green">APPLICATION RECEIVED</div>
    <h1 className="mt-4 text-[clamp(30px,5vw,44px)] font-semibold leading-[1.05] tracking-[-0.03em]">
      Thanks — we'll be in touch within a few days.
    </h1>
    <p className="mt-4 text-[17px] leading-[1.55] text-sw-muted">
      Nothing else to do for now. If anything changes about your fields or your timing, reply to
      the email we send and tell us.
    </p>
    <a href="/" className="mt-8 inline-flex items-center gap-2 text-sw-green hover:text-sw-green-deep">
      <span className="font-plex" aria-hidden="true">←</span> Back to SwathWise
    </a>
  </div>
);
