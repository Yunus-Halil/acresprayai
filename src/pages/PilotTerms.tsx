// The founding pilot's terms and privacy notice, in plain words. Public, so it can be read before accepting an
// invitation. WORDING NEEDS THE FOUNDER'S APPROVAL (and ideally a lawyer's): until TERMS_APPROVED is true the page
// says it is a draft.
//
// Every statement about what is saved, who sees it and what is deleted is a description of what the code does; when
// either changes, the other must (what each sentence rests on is listed in docs/operations/pilot-terms.md).
import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import { CONTACT_EMAIL } from "@/components/landing/copy";
import { TERMS_APPROVED, TERMS_VERSION } from "@/lib/pilot/consent";

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2"><h2 className="font-display text-xl">{title}</h2><div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div></section>;
}
const List = ({ children }: { children: React.ReactNode }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>;
const Strong = ({ children }: { children: React.ReactNode }) => <span className="text-foreground">{children}</span>;

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
          <p>The founding pilot is an early version of Swardus, offered free to a small number of invited growers, consultants, researchers and Extension professionals so that we can learn from real fields. It is experimental: it will have mistakes, it will miss things and report things that are not there, and it will change.</p>
          <p><Strong>What Swardus shows are observations for you to check, not advice.</Strong> Swardus does not recommend treatments, chemicals, products or application rates. Decisions about your field, and the responsibility for them, remain yours. Flying your drone lawfully and having the right to photograph the field are yours too.</p>
          <p>The pilot is provided as it is, with no promise that its findings are complete or correct.</p>
        </Part>

        <Part title="Your photographs">
          <p>Your drone photographs are read in your browser, on your own device. <Strong>They are not uploaded.</Strong></p>
        </Part>

        <Part title="What a saved Field Twin contains">
          <p>When a build finishes, the Field Twin is saved to your account. It holds:</p>
          <List>
            <li>the map Swardus built: the rows, plants and findings it measured and, where it drew one, the edge of the field, each with its position on the ground (latitude and longitude);</li>
            <li>small crops cut from your photographs around the findings;</li>
            <li>facts about the flight: the name you gave the field, how many photographs were used, each photograph's file name and the ground it covered, the camera model, the date of the flight, and whether positions came from RTK or standard GPS.</li>
          </List>
          <p>When the map shows surroundings (roads, place names), the map pieces for your field's area are fetched from OpenStreetMap's servers, which therefore learn roughly where the field is.</p>
        </Part>

        <Part title="The analysis record of a corn Field Twin">
          <p>For a corn Field Twin, Swardus also saves the working data the build produced on the way to the map, as an analysis record beside the Field Twin. It holds:</p>
          <List>
            <li>for every photograph that was used: its file name, file size, size in pixels and the time it was taken; where the camera was at that moment (latitude, longitude and height), which way it was pointing, and the lens values of the camera;</li>
            <li>what Swardus read in each photograph: where in the photograph it found the rows, each plant, each patch of other growth and each gap;</li>
            <li>where each finding on the map lies in each photograph that showed it, and which part of which photograph each crop was cut from.</li>
          </List>
          <p><Strong>It holds no photographs and no image data.</Strong></p>
          <p>We keep it so that the analysis of your field can be reproduced later exactly as it was made, for example to take your corrections into account in your own Field Twin. Today nothing does that yet; the record is only stored.</p>
          <p>The record is private to your account. It is not shown in the app, including to Swardus's founder when a Field Twin is opened (below). It is not used to train a shared model, it is not exported, and it is not shared with other participants. It is deleted when you delete the Field Twin.</p>
          <p>It is saved a moment after the Field Twin itself. If that is interrupted (the tab is closed, or the connection drops), a copy waits in your browser's storage on that device and is sent the next time you open Swardus there while signed in. The waiting copy is removed once it has been saved, when you sign out on that device, when you delete the Field Twin there, or after 7 days, whichever comes first; it is never sent for a Field Twin that has been deleted. A Field Twin whose record never arrives is complete without it.</p>
        </Part>

        <Part title="Your reviews">
          <p>When you mark a finding correct, not sure or wrong, we save your answer, what Swardus had said about the finding, what you said was there instead if you chose one, and any note you wrote. If you redraw the edge of the field, the outline you drew is saved as well. Your reviews never change the saved Field Twin.</p>
        </Part>

        <Part title="Feedback">
          <p>What you send through Feedback is kept and emailed to Swardus's founder. Sent with your words: the page you were on, the Field Twin it was about if any, the app version, your browser and window size, and the last error the app met, if any. Your name, organisation and email address go with it so that we can reply. Your photographs do not.</p>
        </Part>

        <Part title="What we record about how the pilot goes">
          <p>To find out where Swardus works and where it fails, we record what happens in the app, under your account: for example that a build started, the crop, the camera model, how many photographs it used, how long each step took, whether it finished, whether the analysis record was saved and how large it was, and any error. Error messages are filtered to take out file names, folder paths and coordinates before they are recorded. We do not put photographs, field names, positions or boundaries in this record.</p>
        </Part>

        <Part title="What Swardus's founder sees">
          <p>Swardus is run by its founder, who works closely with the people in the pilot. To run the pilot and to find where Swardus is wrong, the founder sees, for every participant:</p>
          <List>
            <li>your account: your email address, your name and organisation if you gave them, when you joined and when you last signed in;</li>
            <li>the list of your Field Twins: each one's name, crop, flight date, number of photographs, camera model, area, and whether it saved completely;</li>
            <li>your reviews: your answers, what you said was there, and your notes;</li>
            <li>your feedback;</li>
            <li>the record of how the pilot goes, described above;</li>
            <li>whether you allowed research use, below.</li>
          </List>
          <p><Strong>The founder may also open your saved Field Twins</Strong> (the map, its positions, and the crops of your photographs) to evaluate how Swardus read your field and to look into problems, for example to see the finding a review of yours is about. This is part of taking part in the pilot. Every opening is recorded with its date and the reason given, and you can read the list at any time under Help, Your data choices.</p>
          <p>No other participant can see anything of yours.</p>
        </Part>

        <Part title="Research use of your imagery: your choice">
          <p>This is optional, it starts switched off, and the pilot works the same either way.</p>
          <p>If you allow it, the crops of your photographs, together with your reviews of them, may be used as examples to test and improve how Swardus reads fields. Without it, your crops are used only to show your Field Twin, to you and to the founder as described above.</p>
          <p>Today Swardus has no export of participants' imagery and trains no shared model on it; this choice records your permission for when it does. You can change it at any time under Help, Your data choices, and a change applies from then on.</p>
          <p>Your Field Twins and reviews are not sold, and are not shared outside Swardus without asking you first, other than with the services named below that store and deliver them for us.</p>
        </Part>

        <Part title="What is yours">
          <p>Your photographs, your Field Twins and your reviews remain yours. By taking part you allow Swardus to store and process them in order to provide the pilot to you and to run it as these terms describe, and for nothing else unless you allow research use above.</p>
          <p>Swardus's software, methods and designs remain Swardus's. If you send us feedback or ideas, we may use them to improve Swardus.</p>
        </Part>

        <Part title="Who handles the data">
          <p>Swardus runs on Supabase (accounts, database and file storage, in the United States) and Vercel (the website). Email is delivered by Resend (invitations to you, and your feedback to the founder) and by Supabase or Resend for sign-in messages. They process data on our behalf to run the service.</p>
          <p>Pages load their fonts from Google, and map surroundings come from OpenStreetMap; like any website you visit, these services see your device's internet address. If you sign in with Google, Google handles that sign-in. A few display settings are remembered in your browser only.</p>
          <p>Each account's Field Twins are private to that account by the rules of the database and the file storage, and connections to Swardus are encrypted. No service can promise perfect security; if we learn that your data was exposed, we will tell you.</p>
        </Part>

        <Part title="Deleting, keeping and backups">
          <p>You can delete any Field Twin from your list at any time. That removes its map, its crops of your photographs, its analysis record if it has one, its place in your list and your reviews of it. What stays: the lines about it in the record of how the pilot goes, which hold nothing of the twin's contents, and any feedback you sent about it.</p>
          <p>You can ask us to delete everything we hold about you: your account, your Field Twins, your reviews, your feedback, your choices, the record of your activity and your application to the pilot. We do this by hand, as soon as we reasonably can.</p>
          <p>Until you delete it or ask us to, what you saved is kept. Copies in emails already delivered, and in the backups our providers keep, are outside our direct control: they are not removed at once and expire on the providers' own schedules.</p>
        </Part>

        <Part title="Ending">
          <p>You can leave the pilot at any time, and we may end the pilot or your place in it. While a place is paused or once it has ended, you can no longer open your Field Twins, and Swardus's founder does not open them either. What you saved is kept, unopened, until you ask us to delete it.</p>
        </Part>

        <Part title="Changes to these terms">
          <p>If what Swardus saves or how it is used changes, these terms change first, under a new version, and you are asked to agree again before you continue. What you agreed to before is not widened without that.</p>
        </Part>

        <Part title="Contact">
          <p>Questions, requests to delete data, or anything else: <a className="text-foreground underline underline-offset-4" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </Part>
      </div>
    </div>
  );
}
