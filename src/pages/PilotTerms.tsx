// The founding pilot's terms and privacy notice, in plain words. Public, so it can be read before accepting an
// invitation. WORDING NEEDS THE FOUNDER'S APPROVAL (and ideally a lawyer's): until TERMS_APPROVED is true the page
// says it is a draft.
import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import { CONTACT_EMAIL } from "@/components/landing/copy";
import { TERMS_APPROVED, TERMS_VERSION } from "@/lib/pilot/consent";

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2"><h2 className="font-display text-xl">{title}</h2><div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div></section>;
}

export default function PilotTerms() {
  return (
    <div className="min-h-screen bg-background">
      <Seo title="Pilot terms and privacy, Swardus" />
      <div className="mx-auto max-w-3xl space-y-8 p-6 sm:p-10">
        {!TERMS_APPROVED && <div role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Draft wording, not yet approved by Swardus.</div>}
        <header>
          <Link to="/" className="text-sm text-muted-foreground hover:underline">Swardus</Link>
          <h1 className="font-display text-3xl">Founding pilot: terms and privacy</h1>
          <p className="text-xs text-muted-foreground">Version {TERMS_VERSION}</p>
        </header>

        <Part title="The pilot">
          <p>The founding pilot is an early version of Swardus, offered free to a small number of invited growers, consultants and researchers so that we can learn from real fields. It will have mistakes and it will change.</p>
          <p className="text-foreground">What Swardus shows are observations for you to check, not advice. Swardus does not recommend treatments, products or rates, and decisions about your field remain yours.</p>
        </Part>

        <Part title="Your photographs and Field Twins">
          <p>Your drone photographs are read on your own computer and are not uploaded. What is saved to your account is the Field Twin: the map Swardus built, small crops of your photographs around each finding, and your reviews of the findings.</p>
          <p>Your Field Twins are private to your account. You can delete any of them at any time, and you can ask us to delete everything we hold about you.</p>
          <p>When the map shows surroundings (roads, place names), the map pieces for your field's area are fetched from OpenStreetMap's servers.</p>
        </Part>

        <Part title="What we record about how the pilot goes">
          <p>To find out where Swardus works and where it fails, we record what happens in the app: for example that a build started, how long it took, how many photographs it used, whether it finished, and any error. We record no photographs, no file names, no field locations and no boundaries in this record.</p>
          <p>We also keep what you send us through Feedback, and your answers to "is this finding correct".</p>
        </Part>

        <Part title="Your two choices">
          <p><span className="text-foreground">Troubleshooting access</span> (optional): if you allow it, Swardus's founder may open your Field Twins to look into a problem. Without it, we look only at what you send us.</p>
          <p><span className="text-foreground">Research use</span> (optional): if you allow it, the crops of your photographs and your reviews may be used to improve how Swardus reads fields. They are not shared outside Swardus without asking you first.</p>
          <p>You can change either choice at any time from Help, and a change applies from then on.</p>
        </Part>

        <Part title="Who handles the data">
          <p>Swardus runs on Supabase (accounts, database and file storage) and Vercel (the website), and sends email through Resend. They process data on our behalf to run the service.</p>
        </Part>

        <Part title="Ending">
          <p>You can leave the pilot at any time, and we may end it or your place in it. Either way, ask and we delete your data.</p>
        </Part>

        <Part title="Contact">
          <p>Questions, requests to delete data, or anything else: <a className="text-foreground underline underline-offset-4" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </Part>
      </div>
    </div>
  );
}
