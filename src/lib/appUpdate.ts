// A new version of the app has been installed in the background and the page has to be reloaded to run it. The reload
// waits for work that a reload would destroy: a Field Twin being built or saved lives in this tab only, and reloading
// in the middle of it would throw the build away (on a slow connection the new version can arrive minutes into one).
//
// So: reload at once when nothing is at stake; otherwise wait until the tab is free again, give what follows a save a
// moment (the analysis record's upload), and reload then. Never more than once.

/** How long after the tab becomes free the reload happens. */
export const SETTLE_AFTER_WORK_MS = 5_000;

export type UpdateHooks = {
  /** True while a reload would lose work. */
  busy: () => boolean;
  /** Hear changes of `busy`. Returns the way to stop hearing. */
  onChange: (cb: () => void) => () => void;
  reload: () => void;
  setTimer?: (cb: () => void, ms: number) => unknown;
};

/** Reload for a new version as soon as that loses nothing. Returns a function that says whether a reload is still owed. */
export function reloadWhenFree(h: UpdateHooks): () => boolean {
  const later = h.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  let done = false, waiting = false;
  const go = () => { if (done) return; done = true; stop(); h.reload(); };
  const check = () => {
    if (done || waiting || h.busy()) return;
    waiting = true;
    later(() => { waiting = false; if (h.busy()) return; go(); }, SETTLE_AFTER_WORK_MS);
  };
  let stop: () => void = () => undefined;
  if (!h.busy()) { go(); return () => false; }
  stop = h.onChange(check);
  return () => !done;
}
