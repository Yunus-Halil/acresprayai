// Who sees the Field Twin page while it is a prototype. This only decides whether the sidebar shows the link and
// the page shows its tools: the data itself is protected by storage policies (each account reads its own folder).
export const FIELD_TWIN_REVIEWERS = ["yunushalilerdogan5@gmail.com"];

export function isFieldTwinReviewer(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return FIELD_TWIN_REVIEWERS.some(r => r.toLowerCase() === e);
}
