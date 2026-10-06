import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { setUnitSystem, useUnitSystem } from "@/hooks/useUnitSystem";
import { loadUnitPreference, saveUnitPreference } from "@/lib/unitPreference";
import { UnitsPrompt } from "@/components/app/UnitsPrompt";
import type { UnitSystem } from "@/lib/units";
import { LayoutDashboard, Map, LogOut, Plane, CloudRain, CalendarDays, Sprout, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import RequireAuth from "@/components/RequireAuth";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import logo from "@/assets/swathwise-logo.png";
import Seo from "@/components/Seo";

const nav = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/app/fields", label: "Fields", icon: Map },
  { to: "/app/fleet", label: "Drone Fleet", icon: Plane },
  // "Weather Radar" until the screen stopped being a radar viewer and started
  // answering where and when you can spray. The route is unchanged.
  { to: "/app/weather", label: "Spray Conditions", icon: CloudRain },
  { to: "/app/schedule", label: "Schedule", icon: CalendarDays },
];
// Developer mode only: the internal review view over the weed reference
// catalog that Weed Scout's identification panel reads from.
const devNav = [
  { to: "/app/weeds", label: "Weed Library", icon: Sprout, end: false },
  // One photo, no orthomosaic: the planting pattern read in the browser.
  { to: "/app/photo", label: "Photo Scout", icon: Camera, end: false },
];
// Reports live per-scan, inside the orthomosaic viewer's Reports tab - there is
// no cross-field reporting page.

export default function AppLayout() {
  return (
    <RequireAuth>
      {/* Signed-in surfaces carry farmer data and have no business in a
          search index. robots.txt disallows them too; this covers the case
          of a crawler that reached the URL from a link anyway. */}
      <Seo title="SwathWise" noindex />
      <AppShell />
    </RequireAuth>
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

function AppShell() {
  // RequireAuth guarantees a user by the time this renders.
  const { user, signOut } = useAuth();
  const dev = useDeveloperMode();
  const items = dev.weedScout ? [...nav, ...devNav] : nav;
  const { units, promptOpen, choose } = useAccountUnits(user.id);

  return (
    <div className="min-h-screen flex bg-background">
      <UnitsPrompt open={promptOpen} initial={units} onChoose={choose} />
      <aside className="w-60 border-r bg-[hsl(var(--field))] text-[hsl(var(--primary-foreground))] flex flex-col">
        <div className="p-5 flex items-center gap-2 font-display text-lg border-b border-white/10">
          <img src={logo} alt="SwathWise" className="h-7 w-7" /> SwathWise
        </div>
        <nav className="p-3 flex-1 space-y-1">
          {items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
                isActive ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]" : "hover:bg-white/5",
              )}
            >
              <item.icon className="h-4 w-4" /> {item.label}
            </NavLink>
          ))}
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
          <div className="px-3 text-xs opacity-60 truncate">{user.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-[hsl(var(--primary-foreground))] hover:bg-white/5 hover:text-[hsl(var(--primary-foreground))]" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}