import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useEffect } from "react";
import { LayoutDashboard, Map, CalendarClock, Sparkles, FileBarChart, LogOut, Loader2, Plane, CloudRain } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import logo from "@/assets/acrespray-logo.png.asset.json";

const nav = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/app/fields", label: "Fields", icon: Map },
  { to: "/app/planner", label: "Mission Planner", icon: CalendarClock },
  { to: "/app/analyzer", label: "AI Analyzer", icon: Sparkles },
  { to: "/app/fleet", label: "Drone Fleet", icon: Plane },
  { to: "/app/weather", label: "Weather Radar", icon: CloudRain },
  { to: "/app/reports", label: "Reports", icon: FileBarChart },
];

export default function AppLayout() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate("/auth", { replace: true });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 border-r bg-[hsl(var(--field))] text-[hsl(var(--primary-foreground))] flex flex-col">
        <div className="p-5 flex items-center gap-2 font-display text-lg border-b border-white/10">
          <img src={logo.url} alt="AcreSpray AI" className="h-7 w-7" /> AcreSpray AI
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