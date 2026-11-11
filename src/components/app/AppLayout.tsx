import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { setUnitSystem, useUnitSystem } from "@/hooks/useUnitSystem";
import { loadUnitPreference, saveUnitPreference } from "@/lib/unitPreference";
import { UnitsPrompt } from "@/components/app/UnitsPrompt";
import type { UnitSystem } from "@/lib/units";
import { LayoutDashboard, Map, LogOut, Plane, CloudRain, CalendarDays, Sprout, Camera, FlaskConical, Shapes, CircleHelp, Plus, MessageSquare, Menu, X, Users, Eye, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import PilotRoute from "@/components/pilot/PilotRoute";
import { usePilot, usePilotRole } from "@/lib/pilot/access";
// WEED-VISION-PREVIEW (temporary research integration; remove with the branch)
import { isWeedVisionPreviewEnabled } from "@/lib/weedVision/flag";
import logo from "@/assets/brand/lockup-white.png";
import Seo from "@/components/Seo";
import { FeedbackHost, openFeedback } from "@/components/pilot/FeedbackDialog";
import AppErrorBoundary from "@/components/pilot/AppErrorBoundary";
import { sessionBusy, useBuildSession } from "@/lib/fieldTwin/buildSession";
import { useAnalysisOutbox } from "@/lib/fieldTwin/analysisAccess";
import { track } from "@/lib/pilot/telemetry";

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

// The pilot: what every member sees. Field Twins is the workspace; everything they make lives there.
const pilotNav: NavItem[] = [
  { to: "/app/twins", label: "Field Twins", icon: Shapes, end: true },
  { to: "/app/twins/new", label: "New Field Twin", icon: Plus, end: true },
  { to: "/app/help", label: "Help", icon: CircleHelp, end: true },
];

// The founder's tools: the orthomosaic workflow, spray operations, the developer views. Kept whole and out of the
// participant's way (their routes are founder-only, and so are the functions behind them).
const founderNav: NavItem[] = [
  { to: "/app", label: "Operations dashboard", icon: LayoutDashboard, end: true },
  { to: "/app/fields", label: "Fields (orthomosaic)", icon: Map },
  { to: "/app/fleet", label: "Drone Fleet", icon: Plane },
  { to: "/app/weather", label: "Spray Conditions", icon: CloudRain },
  { to: "/app/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/app/weeds", label: "Weed Library", icon: Sprout },
  { to: "/app/photo", label: "Photo Scout", icon: Camera },
  { to: "/app/field-twin", label: "Field Twin workbench", icon: Wrench },
  { to: "/admin/pilot", label: "Pilot admin", icon: Users },
  ...(isWeedVisionPreviewEnabled() ? [{ to: "/app/weed-vision", label: "Weed Vision Preview", icon: FlaskConical }] : []),
];

export default function AppLayout() {
  return (
    <PilotRoute>
      {/* Signed-in surfaces carry farmer data and have no business in a
          search index. robots.txt disallows them too; this covers the case
          of a crawler that reached the URL from a link anyway. */}
      <Seo title="Swardus" noindex />
      <AppShell />
    </PilotRoute>
  );
}

/**
 * The account's unit system, made to follow the person.
 *
 * On sign-in the profile's choice replaces whatever this browser last used, so
 * a second device shows the same units as the first. An account that has never
 * chosen is asked once, before it sees a number. After that, any change made
 * anywhere (here, or a field's Settings tab) is written back to the profile.
 */
function useAccountUnits(userId: string) {
  const units = useUnitSystem();
  const [asked, setAsked] = useState<"loading" | "needed" | "done">("loading");
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    setAsked("loading");
    loadUnitPreference(userId)
      .then(saved => {
        if (cancelled) return;
        if (saved) { setUnitSystem(saved); setAsked("done"); }
        else setAsked("needed");
        loaded.current = true;
      })
      .catch(() => { if (!cancelled) { setAsked("done"); loaded.current = true; } });
    return () => { cancelled = true; };
  }, [userId]);

  // Persist changes, but only after the profile has been read: the first
  // render's value is the browser's leftover, not a decision.
  useEffect(() => {
    if (!loaded.current || asked !== "done") return;
    void saveUnitPreference(userId, units);
  }, [units, userId, asked]);

  const choose = (sys: UnitSystem) => {
    setUnitSystem(sys);
    setAsked("done");
    void saveUnitPreference(userId, sys);
  };
  return { units, promptOpen: asked === "needed", choose };
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <>
      {items.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) => cn(
            "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
            isActive ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]" : "hover:bg-white/5",
          )}
        >
          <item.icon className="h-4 w-4 shrink-0" /> {item.label}
        </NavLink>
      ))}
    </>
  );
}

function AppShell() {
  // RequireAuth guarantees a user by the time this renders.
  const { user, signOut } = useAuth();
  const role = usePilotRole();
  const { access, preview, setPreview } = usePilot();
  const isFounderAccount = access.status === "member" && access.serverRole === "founder";
  const { units, promptOpen, choose } = useAccountUnits(user!.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => { track("session_start", { detail: { role: role ?? "none" } }); }, [role]);
  // Corn twins' analysis records still waiting on this device are sent now (analysisOutbox.ts).
  useAnalysisOutbox(user!.id);
  const session = useBuildSession();
  // A twin open is a full-height map workspace; every other page scrolls as a document.
  const fullHeight = /^\/app\/twins\/(?!new$)[^/]+$/.test(location.pathname) || location.pathname === "/app/field-twin";
  // While a build or save runs, every other page says so (the build lives in this tab).
  const showBuildBanner = session.status !== "idle" && sessionBusy(session) && !location.pathname.startsWith("/app/twins/new") && !(session.record && location.pathname === `/app/twins/${session.record.id}`);

  const sidebar = (
    <>
      <div className="p-5 flex items-center justify-between gap-2 font-display text-lg border-b border-white/10">
        <img src={logo} alt="Swardus" className="h-7 w-auto" />
        <button type="button" className="md:hidden rounded p-1 hover:bg-white/10" onClick={() => setMenuOpen(false)} aria-label="Close the menu"><X className="h-5 w-5" /></button>
      </div>
      <nav className="p-3 flex-1 space-y-1 overflow-y-auto" aria-label="Main">
        <div className="px-3 pb-1 text-[10px] uppercase tracking-wider opacity-60">Founding pilot</div>
        <NavList items={pilotNav} onNavigate={() => setMenuOpen(false)} />
        <button type="button" onClick={() => { setMenuOpen(false); openFeedback("problem"); }} className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm transition-colors hover:bg-white/5">
          <MessageSquare className="h-4 w-4 shrink-0" /> Feedback & Support
        </button>
        {role === "founder" && (
          <>
            <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider opacity-60">Founder tools</div>
            <NavList items={founderNav} onNavigate={() => setMenuOpen(false)} />
          </>
        )}
      </nav>
      <div className="p-3 border-t border-white/10 space-y-2">
        {/* One switch for the whole account. The field Settings tab has the
            same control; both write the same store and the same profile row. */}
        <div className="px-3">
          <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">Units</div>
          <div className="inline-flex w-full rounded-sm border border-white/15 overflow-hidden text-xs">
            {([["imperial", "ac · gal"], ["metric", "ha · L"]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setUnitSystem(v)}
                aria-pressed={units === v}
                className={cn("flex-1 px-2 py-1.5 transition-colors",
                  units === v ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-semibold" : "hover:bg-white/5")}
              >{label}</button>
            ))}
          </div>
        </div>
        {isFounderAccount && (
          <label className="flex items-center gap-2 px-3 text-xs cursor-pointer">
            <input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} className="accent-[hsl(var(--accent))]" />
            <Eye className="h-3.5 w-3.5 opacity-70" /> Preview as a participant
          </label>
        )}
        <div className="px-3 text-xs opacity-60 truncate">{user!.email}</div>
        <Button variant="ghost" size="sm" className="w-full justify-start text-[hsl(var(--primary-foreground))] hover:bg-white/5 hover:text-[hsl(var(--primary-foreground))]" onClick={signOut}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className={cn("flex bg-background", fullHeight ? "h-[100dvh]" : "min-h-screen")}>
      <UnitsPrompt open={promptOpen} initial={units} onChoose={choose} />
      {/* Wide screens: a fixed sidebar. Tablets and phones: a top bar with a menu that slides in. */}
      <aside className="hidden md:flex w-60 shrink-0 border-r bg-[hsl(var(--field))] text-[hsl(var(--primary-foreground))] flex-col">{sidebar}</aside>
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-[1100] flex">
          <aside className="w-64 bg-[hsl(var(--field))] text-[hsl(var(--primary-foreground))] flex flex-col shadow-xl">{sidebar}</aside>
          <button type="button" className="flex-1 bg-black/40" onClick={() => setMenuOpen(false)} aria-label="Close the menu" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="md:hidden flex items-center gap-3 border-b bg-[hsl(var(--field))] px-3 py-2 text-[hsl(var(--primary-foreground))]">
          <button type="button" className="rounded p-1 hover:bg-white/10" onClick={() => setMenuOpen(true)} aria-label="Open the menu"><Menu className="h-5 w-5" /></button>
          <img src={logo} alt="Swardus" className="h-6 w-auto" />
        </header>
        {preview && (
          <div role="status" className="flex items-center justify-between gap-3 border-b bg-amber-100 px-4 py-1.5 text-xs text-amber-950">
            <span>You are previewing what a pilot participant sees. Your account keeps its founder access.</span>
            <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setPreview(false)}>Stop previewing</button>
          </div>
        )}
        {session.status !== "idle" && showBuildBanner && (
          <div role="status" className="flex items-center justify-between gap-3 border-b bg-amber-50 px-4 py-1.5 text-xs text-amber-950">
            <span>{session.status === "save-failed" ? `"${session.name}" was built but did not save.` : `${session.status === "saving" ? "Saving" : "Building"} "${session.name}". Keep this tab open.`}</span>
            <NavLink to="/app/twins/new" className="font-semibold underline underline-offset-2">See progress</NavLink>
          </div>
        )}
        <main className={cn("flex-1 overflow-x-hidden", fullHeight && "min-h-0")}>
          <AppErrorBoundary key={location.pathname} withFeedback><Outlet /></AppErrorBoundary>
        </main>
        <FeedbackHost />
      </div>
    </div>
  );
}
