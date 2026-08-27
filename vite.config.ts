import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
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
        name: "SwathWise",
        short_name: "SwathWise",
        description: "Precision drone spraying: scan, plan, spray, and keep the record.",
        theme_color: "#0f0f0f",
        background_color: "#0f0f0f",
        display: "standalone",
        start_url: "/app",
        icons: [
          { src: "/favicon.png", sizes: "512x512", type: "image/png" },
          { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        ],
      },
      workbox: {
        // The app bundle is one large chunk; without this the precache
        // silently skips it and offline cold-opens render a blank page.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
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
