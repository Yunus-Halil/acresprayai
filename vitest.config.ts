import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The Supabase edge functions are Deno modules importing over https, which
      // Node cannot resolve. Point those specifiers at local mocks so the real
      // function code can be loaded and contract-tested. See
      // src/test/edge/harness.ts.
      "https://esm.sh/@supabase/supabase-js@2.45.0": path.resolve(
        __dirname, "./src/test/edge/supabaseClientMock.ts",
      ),
      "https://esm.sh/fflate@0.8.2": path.resolve(__dirname, "./node_modules/fflate"),
    },
  },
});
