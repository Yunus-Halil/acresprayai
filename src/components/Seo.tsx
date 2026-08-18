import { useEffect } from "react";

const SITE = "https://swathwise.com";

type SeoProps = {
  /** Full <title>. Keep under ~60 characters or Google truncates it. */
  title: string;
  /** Under ~155 characters. Only affects how the result reads, not ranking. */
  description?: string;
  /** Path this page canonically lives at, e.g. "/apply". Omit when noindex. */
  path?: string;
  /** Keep the page out of the index. Every signed-in surface sets this. */
  noindex?: boolean;
};

function upsertMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

/**
 * Per-route document head.
 *
 * Worth being clear about the limit of this: it runs in the browser, so it only
 * reaches crawlers that execute JavaScript. Googlebot does. The crawlers behind
 * LinkedIn, Slack and iMessage link previews do not - they read the served
 * index.html and stop. So this fixes titles, descriptions and indexability per
 * route, while every shared link previews as the homepage until the routes are
 * pre-rendered.
 *
 * That tradeoff is fine today: the only link anyone shares is the homepage or
 * /apply, and both should sell the same thing.
 */
export default function Seo({ title, description, path, noindex }: SeoProps) {
  useEffect(() => {
    document.title = title;

    if (description) {
      upsertMeta('meta[name="description"]', "name", "description", description);
      upsertMeta('meta[property="og:description"]', "property", "og:description", description);
    }
    upsertMeta('meta[property="og:title"]', "property", "og:title", title);

    // Absent robots meta means "index, follow", which is what we want on the
    // public pages - so only ever add the tag, and remove it again on the way
    // out so a private route cannot leave the landing page deindexed.
    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (noindex) {
      upsertMeta('meta[name="robots"]', "name", "robots", "noindex, nofollow");
    } else if (robots) {
      robots.remove();
    }

    if (path && !noindex) {
      const href = `${SITE}${path}`;
      let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", href);
      upsertMeta('meta[property="og:url"]', "property", "og:url", href);
    }
  }, [title, description, path, noindex]);

  return null;
}
