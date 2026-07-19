import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // Relative assets keep the compiled bundle portable inside the release's
  // Dashboard/web folder. Production is served over local loopback by Python.
  base: "./",
  plugins: [react()],
  resolve: {
    // Keep fixtures and the developer drawer out of the release artifact, not
    // merely hidden at runtime. TypeScript/tests continue to use App.tsx.
    alias: command === "build"
      ? [{ find: "./App", replacement: "/src/App.production.tsx" }]
      : [],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
}));
