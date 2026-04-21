import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackStart(),
    react(),
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
  ],
});
