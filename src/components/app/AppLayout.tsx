import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { LayoutDashboard, Map, LogOut, Plane, CloudRain } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import RequireAuth from "@/components/RequireAuth";
import logo from "@/assets/swathwise-logo.png";
import Seo from "@/components/Seo";

const nav = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/app/fields", label: "Fields", icon: Map },
  { to: "/app/fleet", label: "Drone Fleet", icon: Plane },
  { to: "/app/weather", label: "Weather Radar", icon: CloudRain },
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

function AppShell() {
  // RequireAuth guarantees a user by the time this renders.
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 border-r bg-[hsl(var(--field))] text-[hsl(var(--primary-foreground))] flex flex-col">
        <div className="p-5 flex items-center gap-2 font-display text-lg border-b border-white/10">
          <img src={logo} alt="SwathWise" className="h-7 w-7" /> SwathWise
        </div>
        <nav className="p-3 flex-1 space-y-1">
          {nav.map(item => (
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