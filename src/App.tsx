import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth.tsx";
import PilotApply from "./pages/PilotApply.tsx";
import PilotApplications from "./pages/admin/PilotApplications.tsx";
import RequireAuth from "./components/RequireAuth.tsx";
import AppLayout from "./components/app/AppLayout.tsx";
import Dashboard from "./pages/app/Dashboard.tsx";
import Fields from "./pages/app/Fields.tsx";
import Fleet from "./pages/app/Fleet.tsx";
import Weather from "./pages/app/Weather.tsx";
import Schedule from "./pages/app/Schedule";
import FieldDetail from "./pages/app/FieldDetail.tsx";
import OrthomosaicViewer from "./pages/app/OrthomosaicViewer.tsx";
import { AuthProvider } from "./lib/auth";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/apply" element={<PilotApply />} />
            <Route
              path="/admin/pilot-applications"
              element={<RequireAuth><PilotApplications /></RequireAuth>}
            />
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="fields" element={<Fields />} />
              <Route path="fields/:id" element={<FieldDetail />} />
              <Route path="fleet" element={<Fleet />} />
              <Route path="weather" element={<Weather />} />
              <Route path="schedule" element={<Schedule />} />
            </Route>
            {/* Gated like the rest of /app. The viewer already refused to
                load without a session, but it did so with a dead-end "Please
                sign in." instead of sending the user to the login page — and
                it was the only /app route outside the guard. Data was never
                exposed (RLS), this is consistency and defence in depth. */}
            <Route
              path="/app/orthomosaic/:taskId"
              element={<RequireAuth><OrthomosaicViewer /></RequireAuth>}
            />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
