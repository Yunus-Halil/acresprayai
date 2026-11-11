// Help for pilot participants: what Swardus does, which photographs it can use, what the labels mean, what is
// saved. Plain words only; every limit stated here is one the product actually has. Keep it in step with the
// photograph check (lib/fieldTwin/preflight.ts) and with the twin viewer's labels.
import { Link } from "react-router-dom";
import { CONTACT_EMAIL } from "@/components/landing/copy";
import Seo from "@/components/Seo";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function Help() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 p-6 sm:p-10">
      <Seo title="Help, Swardus" noindex />
      <header>
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Founding pilot</div>
        <h1 className="font-display text-3xl">How Swardus works</h1>
      </header>

      <Block title="What Swardus does">
        <p>Swardus turns the photographs from one drone flight into a <span className="font-medium text-foreground">Field Twin</span>: a map of your field built straight from those photographs.</p>
        <p>It shows the crop rows or the trees, and the places where something departs from the planting, such as possible weeds or gaps in the stand. For every finding it keeps the photographs the finding came from, so you can look for yourself.</p>
        <p className="font-medium text-foreground">Every finding is an observation for you to check. Swardus does not recommend treatments, products or rates.</p>
      </Block>

      <Block title="Photographs that work">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><span className="text-foreground">From a DJI drone, straight from its memory card.</span> The files carry the drone's position and camera angle, which Swardus needs. Photographs from other makes of drone, from a phone, or edited and re-saved, are not supported yet.</li>
          <li><span className="text-foreground">Camera pointing straight down</span>, as in a planned mapping flight.</li>
          <li><span className="text-foreground">JPEG photographs</span> (files ending in .JPG).</li>
          <li><span className="text-foreground">One flight over one field or block</span>, with plenty of overlap between neighbouring photographs (around 80 % front and side, as mapping apps plan by default).</li>
          <li><span className="text-foreground">Corn</span>: fly low enough to see single plants, about 1 cm of ground per pixel. <span className="text-foreground">Orchards</span>: the tree rows should be visible.</li>
        </ul>
        <p>So far Swardus has been tried on flights of up to about 70 photographs. Bigger flights take longer and use a lot of the computer's memory; if yours is much larger, build one block at a time. Before anything is built, Swardus checks your photographs and tells you, in plain words, about any it cannot use.</p>
      </Block>

      <Block title="Crops">
        <p>The pilot covers <span className="text-foreground">corn</span> and <span className="text-foreground">orchards</span> (trees in rows). You tell Swardus which one it is: it cannot tell corn from another row crop by looking, so a soybean or wheat field built as corn gives wrong results.</p>
      </Block>

      <Block title="Your computer">
        <p>The Field Twin is built on your own computer, in this browser tab. Use a desktop or laptop with a recent Chrome or Edge, and keep the tab open until the twin says it is saved: building takes a few minutes, longer for corn (several seconds per photograph). If the tab is closed early the build is lost and has to be started again.</p>
        <p>Saved Field Twins can be opened on any computer or tablet where you sign in.</p>
      </Block>

      <Block title="What the labels mean">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><span className="text-foreground">Seen in 2 or more photographs</span>: the same thing appeared in the same place in more than one photograph. That says it repeats; it does not say what it is.</li>
          <li><span className="text-foreground">Seen in one photograph</span>: only one photograph saw it. Treat it as a lead to check.</li>
          <li><span className="text-foreground">Photographs disagree</span> (corn): some photographs placed it on a crop row, others between the rows.</li>
          <li><span className="text-foreground">Field boundary</span>: drawn from the crop rows and the photographs. You can adjust it.</li>
          <li><span className="text-foreground">Position on the map</span>: from the drone's own GPS. Without RTK, expect the whole twin to sit a metre or a few off satellite imagery; distances within the field are much closer than that.</li>
        </ul>
      </Block>

      <Block title="Telling us a finding is wrong">
        <p>Click any finding on the map. Above its photographs you can answer <span className="text-foreground">Correct</span>, <span className="text-foreground">Not sure</span> or <span className="text-foreground">Wrong</span>, and add a note. Your answers are saved with the Field Twin, kept apart from what Swardus measured, and they are the most useful thing you can give us: they show where Swardus reads fields well and where it does not.</p>
        <p>The field boundary works the same way: say it looks right, or drag its corners to correct it.</p>
      </Block>

      <Block title="Your data">
        <p>Your photographs stay on your device: they are read here and are not uploaded. Swardus saves the Field Twin itself, meaning the map and small crops of your photographs around each finding, privately in your account. No other participant can see it. Under the pilot terms Swardus's founder may open it to evaluate the pilot, and every opening is recorded for you to see.</p>
        <p>The <Link to="/pilot-terms" className="text-foreground underline underline-offset-4">pilot terms and privacy notice</Link> say what is recorded and who can see it. <Link to="/app/consent" className="text-foreground underline underline-offset-4">Change your data choices</Link>.</p>
      </Block>

      <Block title="Something not right?">
        <p>Use <span className="text-foreground">Feedback & Support</span> in the menu: it reaches Yunus with the page you were on. Or write to <a className="text-foreground underline underline-offset-4" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, saying which Field Twin and what you expected to see.</p>
        <p><Link to="/app/twins" className="text-foreground underline underline-offset-4">Back to your Field Twins</Link></p>
      </Block>
    </div>
  );
}
