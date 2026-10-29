import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { execSync } from "child_process";
import fs from "fs";
import type { Plugin } from "vite";

// The commit the build came from, stamped into the bundle so the scan page's
// footer can say which version is on screen. Vercel sets the SHA at build
// time; a local build asks git; a checkout with neither says "dev".
const buildSha = (): string => {
  const given = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;
  if (given) return given.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev"; } catch { return "dev"; }
};

// https://vitejs.dev/config/
// WEED-VISION-PREVIEW (temporary research integration; remove with the branch):
// in `vite` dev with VITE_WEED_VISION_PREVIEW=true, forward /weed-vision-api to
// the local Python research service on loopback. Never in a build.
const weedVisionProxy = (mode: string) =>
  mode === "development" && loadEnv(mode, process.cwd(), "VITE_").VITE_WEED_VISION_PREVIEW === "true"
    ? { "/weed-vision-api": { target: "http://127.0.0.1:8765", changeOrigin: false, rewrite: (p: string) => p.replace(/^\/weed-vision-api/, "/weed-vision") } }
    : undefined;

// Field Twin (dev server only): serve the twins scripts/directGeoref/buildTwin.ts wrote to
// data/direct-georef/twin/<id>/, so the Field Twin page can save one to the signed-in account. Only twin ids and
// the bundle's own file names are answered; nothing else under data/ is reachable. Never part of a build.
const fieldTwinDevFiles = (): Plugin => ({
  name: "field-twin-dev-files",
  apply: "serve",
  configureServer(server) {
    const root = path.resolve(__dirname, "data/direct-georef/twin");
    server.middlewares.use("/__field-twin", (req, res, next) => {
      const url = (req.url ?? "/").split("?")[0];
      if (url === "/" || url === "") {
        const ids = fs.existsSync(root) ? fs.readdirSync(root).filter(d => /^[a-z0-9][a-z0-9-]{0,63}$/.test(d) && fs.existsSync(path.join(root, d, "twin.json"))) : [];
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(ids));
        return;
      }
      const m = /^\/([a-z0-9][a-z0-9-]{0,63})\/(twin\.json|atlas-\d+\.jpg)$/.exec(url);
      if (!m) return next();
      const file = path.join(root, m[1], m[2]);
      if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
      res.setHeader("Content-Type", m[2].endsWith(".json") ? "application/json" : "image/jpeg");
      fs.createReadStream(file).pipe(res);
    });
  },
});

export default defineConfig(({ mode }) => ({
  // The twin's build worker and its helpers are module workers (runBuild.ts, worker.ts); they carry geotiff.js,
  // which splits its decoders into chunks, and a split bundle cannot be an IIFE worker.
  worker: { format: "es" },
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: weedVisionProxy(mode), // WEED-VISION-PREVIEW
  },
  plugins: [
    react(),
    fieldTwinDevFiles(),
    // The offline shell. Operators plan at home and stand in fields with no
    // signal: the app shell precaches so a cold open renders, and everything
    // browsed with connectivity (field/grid/plan/log rows, ortho tiles,
    // basemap) is served from cache when the network is gone. READ-ONLY by
    // design — writes are not queued here; every write path already detects
    // failure and says so (Part 1), and the Log Flight dialog keeps a local
    // draft. NetworkFirst on data keeps cached rows a fallback, never a
    // stale-first source.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "favicon.png", "apple-touch-icon.png", "robots.txt"],
      manifest: {
        name: "Swardus",
        short_name: "Swardus",
        description: "Precision drone spraying: scan, plan, spray, and keep the record.",
        theme_color: "#0f0f0f",
        background_color: "#0f0f0f",
        display: "standalone",
        start_url: "/app",
        icons: [
          { src: "/favicon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/favicon.png", sizes: "512x512", type: "image/png" },
          { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        ],
      },
      workbox: {
        // The app bundle is one large chunk; without this the precache
        // silently skips it and offline cold-opens render a blank page.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        // The raw website screenshots (public/screens) are source captures, not served by any page since the
        // 2026-10-27 redesign (it uses the WebP copies in public/site). Precaching them cost every install
        // about 3 MB, which matters on a rural connection.
        globIgnores: ["screens/**"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/functions\//, /^\/rest\//],
        runtimeCaching: [
          {
            // Supabase REST reads: fields (boundary + settings carry the grid
            // and flight plan), scans, flight logs, report rows. Network
            // first, cache as the offline fallback.
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/rest\/v1\//,
            method: "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-rest",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 400, maxAgeSeconds: 14 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Baked ortho tiles served through the tile edge function. The
            // signed token is part of the cache key, so reuse holds within a
            // session: a field opened with signal keeps its map without it.
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/tile\//,
            method: "GET",
            handler: "CacheFirst",
            options: {
              cacheName: "ortho-tiles",
              expiration: { maxEntries: 3000, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Basemap imagery (Esri satellite / OSM street).
            urlPattern: /^https:\/\/(server\.arcgisonline\.com|[abc]\.tile\.openstreetmap\.org)\//,
            method: "GET",
            handler: "CacheFirst",
            options: {
              cacheName: "basemap-tiles",
              expiration: { maxEntries: 1500, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css", expiration: { maxEntries: 8, maxAgeSeconds: 365 * 24 * 3600 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-files",
              expiration: { maxEntries: 24, maxAgeSeconds: 365 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
