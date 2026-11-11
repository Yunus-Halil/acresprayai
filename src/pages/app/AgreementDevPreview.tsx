// Development only (localhost): the pilot agreement screen exactly as a participant sees it, without an invited
// account and without recording anything. /dev/agreement is a new participant's screen; /dev/agreement?changed=1 is
// the screen of someone who agreed to the earlier terms. The founder's own account is never asked, so this is the
// way to look at it. Not part of a production build (see App.tsx).
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AgreementForm, Screen } from "@/components/pilot/ConsentScreen";
import { TERMS_VERSION } from "@/lib/pilot/consent";

export default function AgreementDevPreview() {
  const [params] = useSearchParams();
  const changed = params.get("changed") === "1";
  const [agreed, setAgreed] = useState<{ research_use: boolean } | null>(null);
  if (agreed) {
    return (
      <Screen title="The participant is now in Swardus">
        <p className="text-sm text-muted-foreground">Preview only: nothing was recorded. A real agreement would have written one row: terms {TERMS_VERSION}, the founder may open their Field Twins, research use {agreed.research_use ? "allowed" : "not allowed"}.</p>
        <p className="text-sm"><button type="button" className="underline underline-offset-4" onClick={() => setAgreed(null)}>Show the screen again</button> · <Link className="underline underline-offset-4" to={changed ? "/dev/agreement" : "/dev/agreement?changed=1"}>{changed ? "As a new participant" : "As someone who agreed to the earlier terms"}</Link> · <Link className="underline underline-offset-4" to="/pilot-terms">The full terms</Link></p>
      </Screen>
    );
  }
  return (
    <Screen title={changed ? "The pilot terms have changed" : "Welcome to the Swardus founding pilot"}>
      <AgreementForm
        current={changed ? { terms_version: "pilot-2026-11-v1", troubleshooting_access: false, research_use: true, created_at: "2026-11-09T10:00:00Z" } : null}
        save={async choices => { setAgreed(choices); }}
        onDone={() => undefined}
      />
    </Screen>
  );
}
