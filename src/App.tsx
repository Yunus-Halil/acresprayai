import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth.tsx";
import AuthWelcome from "./pages/AuthWelcome.tsx";
import PilotApply from "./pages/PilotApply.tsx";
import PilotRoute from "./components/pilot/PilotRoute.tsx";
import { FounderOnly } from "./components/pilot/PilotGate.tsx";
import AppLayout from "./components/app/AppLayout.tsx";
import { usePilotRole } from "./lib/pilot/access";
import { isWeedVisionPreviewEnabled } from "./lib/weedVision/flag";
import { AuthProvider } from "./lib/auth";
import AppErrorBoundary from "./components/pilot/AppErrorBoundary";
import PilotTerms from "./pages/PilotTerms.tsx";

// Every page inside the app is its own chunk, fetched when it is opened. The landing page and the sign-in pages no
// longer download the whole application (it was one 3.7 MB script), and a pilot participant never downloads the
// founder's tools at all: those routes are founder-only below, so their chunks are never requested.
const Dashboard = lazy(() => import("./pages/app/Dashboard.tsx"));
const Fields = lazy(() => import("./pages/app/Fields.tsx"));
const Fleet = lazy(() => import("./pages/app/Fleet.tsx"));
const Weather = lazy(() => import("./pages/app/Weather.tsx"));
const Schedule = lazy(() => import("./pages/app/Schedule"));
const FieldDetail = lazy(() => import("./pages/app/FieldDetail.tsx"));
const OrthomosaicViewer = lazy(() => import("./pages/app/OrthomosaicViewer.tsx"));
const WeedLibrary = lazy(() => import("./pages/app/WeedLibrary.tsx"));
const PhotoScout = lazy(() => import("./pages/app/PhotoScout.tsx"));
const PilotAdmin = lazy(() => import("./pages/admin/PilotAdmin.tsx"));
const AdminTwinViewer = lazy(() => import("./pages/admin/AdminTwinViewer.tsx"));
const Help = lazy(() => import("./pages/app/Help.tsx"));
const TwinsHome = lazy(() => import("./pages/app/TwinsHome.tsx"));
const TwinNew = lazy(() => import("./pages/app/TwinNew.tsx"));
const TwinOpen = lazy(() => import("./pages/app/TwinOpen.tsx"));
const ConsentPage = lazy(() => import("./components/pilot/ConsentScreen.tsx"));
// The Field Twin page as it was before the pilot: the founder's workbench (twins built on this computer, twins from
// files, the reference orthomosaic). Participants use the Field Twins pages instead.
const FieldTwin = lazy(() => import("./pages/app/FieldTwin.tsx"));
// WEED-VISION-PREVIEW (temporary research integration; remove with the branch). Development builds with the flag
// only; the import is inside the condition so a production build emits no chunk for it.
const WeedVisionPreview = isWeedVisionPreviewEnabled() ? lazy(() => import("./pages/app/WeedVisionPreview.tsx")) : null;
// Development only: the viewer over a twin built on this computer, no sign-in (for the screenshot/benchmark script).
const FieldTwinDevPreview = import.meta.env.DEV ? lazy(() => import("./pages/app/FieldTwinDevPreview.tsx")) : null;
// Development only: the pilot agreement screen as a new or a returning participant sees it; nothing is recorded.
const AgreementDevPreview = import.meta.env.DEV ? lazy(() => import("./pages/app/AgreementDevPreview.tsx")) : null;

const queryClient = new QueryClient();

function PageLoading() {
  return <div className="flex min-h-[50vh] items-center justify-center" aria-busy="true"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
}
const page = (el: ReactNode) => <Suspense fallback={<PageLoading />}>{el}</Suspense>;
const founder = (el: ReactNode) => <FounderOnly>{page(el)}</FounderOnly>;

/** /app itself: the founder's operations dashboard, or a participant's Field Twins. */
function AppHome() {
  const role = usePilotRole();
  if (role === "founder") return page(<Dashboard />);
  return <Navigate to="/app/twins" replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppErrorBoundary>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/welcome" element={<AuthWelcome />} />
            <Route path="/apply" element={<PilotApply />} />
            <Route path="/pilot-terms" element={<PilotTerms />} />
            {FieldTwinDevPreview && <Route path="/dev/field-twin" element={<Suspense fallback={null}><FieldTwinDevPreview /></Suspense>} />}
            {AgreementDevPreview && <Route path="/dev/agreement" element={<Suspense fallback={null}><AgreementDevPreview /></Suspense>} />}
            {/* The founder's pilot admin panel. Founder-only here and in pilot-admin. */}
            <Route path="/admin/pilot" element={<PilotRoute>{founder(<PilotAdmin />)}</PilotRoute>} />
            <Route path="/admin/pilot/people/:id" element={<PilotRoute>{founder(<PilotAdmin />)}</PilotRoute>} />
            <Route path="/admin/pilot/twins/:id" element={<PilotRoute>{founder(<AdminTwinViewer />)}</PilotRoute>} />
            <Route path="/admin/pilot-applications" element={<Navigate to="/admin/pilot" replace />} />
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<AppHome />} />
              {/* The pilot: everyone in it. */}
              <Route path="twins" element={page(<TwinsHome />)} />
              <Route path="twins/new" element={page(<TwinNew />)} />
              <Route path="twins/:id" element={page(<TwinOpen />)} />
              <Route path="help" element={page(<Help />)} />
              <Route path="consent" element={page(<ConsentPage />)} />
              {/* The founder's tools. Kept whole; a participant who opens one by its address is sent home, and the
                  server refuses their functions regardless (supabase/functions/_shared/access.ts). */}
              <Route path="fields" element={founder(<Fields />)} />
              <Route path="fields/:id" element={founder(<FieldDetail />)} />
              <Route path="fleet" element={founder(<Fleet />)} />
              <Route path="weather" element={founder(<Weather />)} />
              <Route path="schedule" element={founder(<Schedule />)} />
              <Route path="weeds" element={founder(<WeedLibrary />)} />
              <Route path="photo" element={founder(<PhotoScout />)} />
              <Route path="field-twin" element={founder(<FieldTwin />)} />
              {WeedVisionPreview && <Route path="weed-vision" element={founder(<WeedVisionPreview />)} />}
            </Route>
            <Route path="/app/orthomosaic/:taskId" element={<PilotRoute>{founder(<OrthomosaicViewer />)}</PilotRoute>} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </AppErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
