import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app calls the API on its own origin (/api/...). In development, and
// in `vite preview`, these requests are forwarded to the API server, the
// same way Vercel forwards them in production (see vercel.json).
const apiOrigin = process.env.API_ORIGIN || "http://localhost:4000";
const proxy = { "/api": { target: apiOrigin } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { proxy },
});
