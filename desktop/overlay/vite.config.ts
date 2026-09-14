import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  clearScreen: false,
  plugins: [react()],
  css: {
    postcss: { plugins: [] },
  },
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: { target: "es2021", sourcemap: false },
});
