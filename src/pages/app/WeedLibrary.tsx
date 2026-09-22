// Weed Library: the internal review view over the state weed reference
// catalog (lib/weedCatalog). Reachable from the sidebar in developer mode and
// from a Weed Scout identification.
//
// What it is for: a developer or reviewer searching the catalog, reading each
// entry's sources, and seeing which entries are unresolved (scientific name
// not matched to the USDA checklist, crop-guide group labels, habitat cues
// awaiting a human read). Every entry is labelled by how it got here; nothing
// on this page presents a record as a confirmed farm weed, a presence claim,
// or a visual identification, because the catalog makes none of those claims.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ExternalLink, Search, Sprout } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { summariseEntries } from "@/lib/weedCatalog/import";
import { ASSUMED_REGION_WARNING, fieldRegion } from "@/lib/weedCatalog/region";
import { loadCatalog, loadReviewQueue, loadSources } from "@/lib/weedCatalog/repo";
import { evidenceLabel, narrowCatalog, presenceNote, regulatoryNote, searchRanked, type RankedEntry } from "@/lib/weedCatalog/suggest";
import { CROP_CONTEXTS, CROP_CONTEXT_LABEL, type CatalogEntry, type CatalogSource, type CropContext, type ReviewQueueItem } from "@/lib/weedCatalog/types";

const STATUS_LABEL: Record<string, string> = {
  source_index_only: "Identification index only",
  crop_context_sourced: "Named in a crop guide table",
  regulatory_only: "Law listing only",
};
const USDA_LABEL: Record<string, string> = {
  matched: "USDA checklist: name matched",
  unmatched_requires_review: "USDA checklist: name unresolved (needs review)",
  not_crosswalked: "USDA checklist: not attempted (law-only listing)",
};
const REVIEW_LABEL: Record<string, string> = {
  unreviewed: "Not yet reviewed by a weed scientist",
  expert_reviewed: "Expert reviewed",
  excluded: "Excluded by review",
};

export default function WeedLibrary() {
  const region = fieldRegion();
  const [params, setParams] = useSearchParams();
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [sources, setSources] = useState<CatalogSource[]>([]);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState<string>("all");
  const [crop, setCrop] = useState<string>("all");
  const [tier, setTier] = useState<string>("all");
  const [plantType, setPlantType] = useState<string>("all");
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);
  const [onlyCues, setOnlyCues] = useState(false);
  const [limit, setLimit] = useState(100);
  const selectedId = params.get("id");

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadCatalog(region.state), loadSources(region.state), loadReviewQueue(region.state)])
      .then(([e, s, q]) => { if (!cancelled) { setEntries(e); setSources(s); setQueue(q); setError(null); } })
      .catch(err => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [region.state]);

  const ranked = useMemo(
    () => narrowCatalog(entries ?? [], { region, crop: null }).ranked,
    [entries, region],
  );
  const summary = useMemo(() => summariseEntries(entries ?? []), [entries]);
  const tiers = useMemo(() => [...new Set((entries ?? []).map(e => e.regulatory_tier).filter(Boolean))].sort() as string[], [entries]);
  const plantTypes = useMemo(() => [...new Set((entries ?? []).map(e => e.plant_type))].sort(), [entries]);
  const queueByEntry = useMemo(() => {
    const m = new Map<string, ReviewQueueItem[]>();
    for (const q of queue) if (q.catalog_id) m.set(q.catalog_id, [...(m.get(q.catalog_id) ?? []), q]);
    return m;
  }, [queue]);
  const sourceById = useMemo(() => new Map(sources.map(s => [s.source_id, s])), [sources]);

  const filtered: RankedEntry[] = useMemo(() => {
    let rows = searchRanked(ranked, query);
    if (status !== "all") rows = rows.filter(r => r.entry.catalog_status === status);
    if (crop !== "all") rows = rows.filter(r => r.entry.crop_contexts.includes(crop));
    if (tier !== "all") rows = rows.filter(r => r.entry.regulatory_tier === tier);
    if (plantType !== "all") rows = rows.filter(r => r.entry.plant_type === plantType);
    if (onlyUnresolved) rows = rows.filter(r => r.entry.usda_status === "unmatched_requires_review" || (queueByEntry.get(r.entry.catalog_id)?.length ?? 0) > 0);
    if (onlyCues) rows = rows.filter(r => r.entry.habitat_flags.length > 0);
    return rows;
  }, [ranked, query, status, crop, tier, plantType, onlyUnresolved, onlyCues, queueByEntry]);

  const selected = selectedId ? entries?.find(e => e.catalog_id === selectedId) ?? null : null;
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("id", id); else next.delete("id");
    setParams(next, { replace: true });
  };

  const version = entries?.[0]?.catalog_version ?? null;
  const asOf = entries?.[0]?.as_of ?? null;
  const openQueue = queue.filter(q => !q.resolved).length;

  return (
    <div className="p-8 space-y-6">
      <Card role="status" className="p-4 text-sm border-amber-500/60 bg-amber-500/10">
        <span className="font-semibold">Testing assumption: </span>{ASSUMED_REGION_WARNING}
      </Card>

      <header className="space-y-2">
        <h1 className="font-display text-3xl inline-flex items-center gap-2"><Sprout className="h-7 w-7 text-primary" /> Weed Library</h1>
        <p className="text-muted-foreground max-w-3xl">
          The {region.stateName} weed reference catalog{version ? `, version ${version}` : ""}{asOf ? ` as of ${asOf}` : ""}:
          sourced names from the state identification index, the USDA state plants checklist, the field-crop guide
          tables and the noxious weed regulation. It is a research inventory for human review. A record here is not a
          verified farm weed, not proof a plant is on any field, and no entry has been validated for identification
          from aerial imagery. Nothing on this page comes from image analysis.
        </p>
      </header>

      {error && (
        <Card className="p-4 text-sm border-destructive/50 text-destructive">
          Couldn&rsquo;t load the catalog ({error}). This is a loading failure, not an empty catalog.
        </Card>
      )}

      {entries && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 text-sm">
          <Stat label="Source records" value={summary.total} note="not verified farm weeds" />
          <Stat label="Named in a crop guide" value={summary.byStatus.crop_context_sourced} note="preliminary crop context" />
          <Stat label="Index only" value={summary.byStatus.source_index_only} note="broad clinic index" />
          <Stat label="Law only" value={summary.byStatus.regulatory_only} note="possibly absent locally" />
          <Stat label="Names unresolved" value={summary.unresolvedUsda} note="no exact USDA match" />
          <Stat label="Habitat cues only" value={summary.agriculturalCueOnly} note="automated, unverified" />
          <Stat label="Review queue" value={`${openQueue} / ${queue.length}`} note="open / total" />
        </div>
      )}

      <Tabs defaultValue="entries">
        <TabsList>
          <TabsTrigger value="entries">Entries</TabsTrigger>
          <TabsTrigger value="queue">Review queue ({queue.length})</TabsTrigger>
          <TabsTrigger value="sources">Sources ({sources.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="entries" className="space-y-4 pt-2">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search common or scientific name, USDA symbol or catalog id"
                value={query} onChange={e => { setQuery(e.target.value); setLimit(100); }} />
            </div>
            <select className="h-10 rounded-md border bg-background px-2 text-sm" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="all">Any evidence</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="h-10 rounded-md border bg-background px-2 text-sm" value={crop} onChange={e => setCrop(e.target.value)}>
              <option value="all">Any crop context</option>
              {CROP_CONTEXTS.map(c => <option key={c} value={c}>{CROP_CONTEXT_LABEL[c]}</option>)}
            </select>
            <select className="h-10 rounded-md border bg-background px-2 text-sm" value={tier} onChange={e => setTier(e.target.value)}>
              <option value="all">Any legal status</option>
              {tiers.map(t => <option key={t} value={t}>{t} noxious</option>)}
            </select>
            <select className="h-10 rounded-md border bg-background px-2 text-sm" value={plantType} onChange={e => setPlantType(e.target.value)}>
              <option value="all">Any plant type</option>
              {plantTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
            <label className="text-sm inline-flex items-center gap-1.5"><input type="checkbox" checked={onlyUnresolved} onChange={e => setOnlyUnresolved(e.target.checked)} /> Unresolved only</label>
            <label className="text-sm inline-flex items-center gap-1.5"><input type="checkbox" checked={onlyCues} onChange={e => setOnlyCues(e.target.checked)} /> With habitat cues</label>
          </div>
          <div className="text-xs text-muted-foreground">
            {entries ? `${filtered.length} of ${ranked.length} entries. Crop-guide entries are listed first; that is an ordering, not evidence.` : "Loading the catalog"}
          </div>

          <div className="grid lg:grid-cols-[1fr_minmax(320px,420px)] gap-4 items-start">
            <ul className="divide-y rounded-md border">
              {filtered.slice(0, limit).map(({ entry: e, why }) => {
                const q = queueByEntry.get(e.catalog_id) ?? [];
                return (
                  <li key={e.catalog_id}>
                    <button type="button" onClick={() => select(e.catalog_id)}
                      className={`w-full text-left px-3 py-2 hover:bg-muted/50 ${selectedId === e.catalog_id ? "bg-muted" : ""}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{e.common_name}</span>
                        <span className="italic text-muted-foreground text-sm">{e.scientific_name_as_source}</span>
                        <Badge variant="outline" className="text-[10px]">{evidenceLabel(e)}</Badge>
                        {e.regulatory_tier && <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">{e.regulatory_tier} noxious (legal status)</Badge>}
                        {e.usda_status === "unmatched_requires_review" && <Badge variant="outline" className="text-[10px]">name unresolved</Badge>}
                        {q.length > 0 && <Badge variant="outline" className="text-[10px]">{q.length} review item{q.length === 1 ? "" : "s"}</Badge>}
                        {e.review_status !== "unreviewed" && <Badge variant="outline" className="text-[10px]">{REVIEW_LABEL[e.review_status]}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{why}</div>
                    </button>
                  </li>
                );
              })}
              {entries && filtered.length === 0 && <li className="px-3 py-6 text-sm text-muted-foreground text-center">No entry matches.</li>}
            </ul>
            {filtered.length > limit && (
              <button type="button" className="text-sm underline text-muted-foreground lg:col-start-1" onClick={() => setLimit(l => l + 200)}>
                Show more ({filtered.length - limit} remaining)
              </button>
            )}

            <div className="lg:col-start-2 lg:row-start-1 lg:row-span-2">
              {selected ? (
                <EntryDetail entry={selected} queue={queueByEntry.get(selected.catalog_id) ?? []} sourceById={sourceById} onClose={() => select(null)} />
              ) : (
                <Card className="p-4 text-sm text-muted-foreground">Select an entry to read its sources, crop evidence, legal status and review state.</Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="queue" className="pt-2 space-y-3">
          <p className="text-sm text-muted-foreground max-w-3xl">
            Names and associations that did not resolve cleanly. Each one is a question for a weed scientist or Extension
            specialist, not a defect in the field data. Nothing here is promoted until a person resolves it.
          </p>
          <QueueList queue={queue} onOpen={id => select(id)} />
        </TabsContent>

        <TabsContent value="sources" className="pt-2 grid md:grid-cols-2 gap-3">
          {sources.map(s => (
            <Card key={s.source_id} className="p-4 space-y-1">
              <div className="font-medium">{s.title}</div>
              <a className="text-sm text-primary inline-flex items-center gap-1 break-all" href={s.url} target="_blank" rel="noreferrer">{s.url} <ExternalLink className="h-3 w-3" /></a>
              <div className="text-xs text-muted-foreground">Accessed {s.accessed ?? "date not recorded"}. Source id {s.source_id}.</div>
              <div className="text-sm">{s.scope}</div>
            </Card>
          ))}
          {sources.length === 0 && !error && <Card className="p-4 text-sm text-muted-foreground">No sources loaded.</Card>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-medium">{value}</div>
      <div className="text-[11px] text-muted-foreground">{note}</div>
    </Card>
  );
}

function EntryDetail({ entry: e, queue, sourceById, onClose }: {
  entry: CatalogEntry; queue: ReviewQueueItem[]; sourceById: Map<string, CatalogSource>; onClose: () => void;
}) {
  const reg = regulatoryNote(e);
  return (
    <Card className="p-4 space-y-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-medium">{e.common_name}</div>
          <div className="italic text-muted-foreground">{e.scientific_name_as_source}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{e.catalog_id}, {e.plant_type.replace(/_/g, " ")}. Catalog {e.catalog_version}{e.as_of ? `, as of ${e.as_of}` : ""}.</div>
        </div>
        <button type="button" className="text-xs underline text-muted-foreground" onClick={onClose}>Close</button>
      </div>

      <Section title="How it got here">
        <div>{STATUS_LABEL[e.catalog_status]}</div>
        <div className="text-muted-foreground">{presenceNote(e)}</div>
      </Section>

      <Section title="Crop guide evidence">
        {e.crop_evidence.length ? (
          <ul className="space-y-1">
            {e.crop_evidence.map((ev, i) => (
              <li key={i}>
                <span className="font-medium">{CROP_CONTEXT_LABEL[ev.crop as CropContext] ?? ev.crop}</span>: {ev.locator}
                {ev.evidence ? ` (${ev.evidence})` : ""} in {sourceById.get(ev.source_id)?.title ?? ev.source_id}
              </li>
            ))}
            <li className="text-muted-foreground">Preliminary. The guide covers the Mid-Atlantic; a table naming this weed is crop relevance, not prevalence in any county.</li>
          </ul>
        ) : <div className="text-muted-foreground">None. No crop guide table captured here names this entry.</div>}
      </Section>

      <Section title="Legal status (separate from crop relevance)">
        {reg ? <div className="text-amber-700 dark:text-amber-400 inline-flex gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span>{reg}</span></div>
          : <div className="text-muted-foreground">Not listed in the Virginia noxious weed regulation captured here.</div>}
      </Section>

      <Section title="Name reconciliation">
        <div>{USDA_LABEL[e.usda_status]}</div>
        {e.usda_symbol && <div>USDA symbol {e.usda_symbol}{e.review_status === "unreviewed" ? " (provisional crosswalk)" : ""}</div>}
        {e.usda_candidate_symbols.length > 1 && <div className="text-muted-foreground">Candidate symbols: {e.usda_candidate_symbols.join(", ")}</div>}
        {e.resolved_scientific_name && <div>Reviewer-resolved name: <span className="italic">{e.resolved_scientific_name}</span></div>}
      </Section>

      <Section title="Habitat review cues (automated, unverified)">
        {e.habitat_flags.length
          ? <div>{e.habitat_flags.map(f => f.replace(/_/g, " ")).join(", ")}. Read the profile before treating any of these as a crop association.</div>
          : <div className="text-muted-foreground">{e.habitat_profile_checked ? "Profile checked; no cue matched." : "Profile not checked (law-only listing)."}</div>}
      </Section>

      <Section title="Review state">
        <div>{REVIEW_LABEL[e.review_status]}{e.reviewed_at ? `, ${e.reviewed_at.slice(0, 10)}` : ""}</div>
        {e.review_notes && <div className="text-muted-foreground">{e.review_notes}</div>}
        {e.pending_source_update != null && <div className="text-amber-700 dark:text-amber-400">A newer upstream record is waiting for the reviewer; the reviewed values were kept.</div>}
        <div className="text-muted-foreground">Aerial identification validated: no. No entry in this build has an image-based accuracy study.</div>
        {queue.length > 0 && (
          <ul className="mt-1 space-y-1">
            {queue.map(q => <li key={q.id} className="text-muted-foreground">Review item: {q.label}. {q.reason}</li>)}
          </ul>
        )}
      </Section>

      <Section title="Sources">
        <ul className="space-y-1">
          {e.source_ids.map(sid => {
            const s = sourceById.get(sid);
            return <li key={sid}>{s ? <a className="text-primary inline-flex items-center gap-1" href={s.url} target="_blank" rel="noreferrer">{s.title} <ExternalLink className="h-3 w-3" /></a> : sid}</li>;
          })}
          {e.vt_profile_url && <li><a className="text-primary inline-flex items-center gap-1 break-all" href={e.vt_profile_url} target="_blank" rel="noreferrer">Profile page {e.vt_profile_url} <ExternalLink className="h-3 w-3" /></a></li>}
        </ul>
      </Section>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function QueueList({ queue, onOpen }: { queue: ReviewQueueItem[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("all");
  const sources = useMemo(() => [...new Set(queue.map(i => i.source_id ?? "none"))].sort(), [queue]);
  const rows = queue.filter(i =>
    (source === "all" || (i.source_id ?? "none") === source) &&
    (!q.trim() || `${i.label} ${i.reason} ${i.catalog_id ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const groups = new Map<string, ReviewQueueItem[]>();
  for (const r of rows) groups.set(r.reason, [...(groups.get(r.reason) ?? []), r]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-sm" placeholder="Filter by name or reason" value={q} onChange={e => setQ(e.target.value)} />
        <select className="h-10 rounded-md border bg-background px-2 text-sm" value={source} onChange={e => setSource(e.target.value)}>
          <option value="all">Any source</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {[...groups.entries()].map(([reason, items]) => (
        <Card key={reason} className="p-4 space-y-2">
          <div className="text-sm">{reason}</div>
          <div className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</div>
          <div className="flex flex-wrap gap-1.5">
            {items.map(i => (
              i.catalog_id
                ? <button key={i.id} type="button" onClick={() => onOpen(i.catalog_id!)} className="text-xs rounded border px-2 py-0.5 hover:bg-muted">{i.label}{i.resolved ? " (resolved)" : ""}</button>
                : <span key={i.id} className="text-xs rounded border px-2 py-0.5 text-muted-foreground">{i.label}{i.resolved ? " (resolved)" : ""}</span>
            ))}
          </div>
        </Card>
      ))}
      {rows.length === 0 && <Card className="p-4 text-sm text-muted-foreground">No review items match.</Card>}
    </div>
  );
}
