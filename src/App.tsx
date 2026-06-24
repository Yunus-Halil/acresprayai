import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth.tsx";
import AppLayout from "./components/app/AppLayout.tsx";
import Dashboard from "./pages/app/Dashboard.tsx";
import Fields from "./pages/app/Fields.tsx";
import Planner from "./pages/app/Planner.tsx";
import Analyzer from "./pages/app/Analyzer.tsx";
import Reports from "./pages/app/Reports.tsx";
import Fleet from "./pages/app/Fleet.tsx";
import Weather from "./pages/app/Weather.tsx";
import Models3D from "./pages/app/Models3D.tsx";
import FieldView from "./pages/app/FieldView.tsx";
import FieldMap from "./pages/app/FieldMap.tsx";
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
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="fields" element={<Fields />} />
              <Route path="fields/:id/map" element={<FieldMap />} />
              <Route path="field-view" element={<FieldView />} />
              <Route path="planner" element={<Planner />} />
              <Route path="analyzer" element={<Analyzer />} />
              <Route path="fleet" element={<Fleet />} />
              <Route path="weather" element={<Weather />} />
              <Route path="models" element={<Models3D />} />
              <Route path="reports" element={<Reports />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
