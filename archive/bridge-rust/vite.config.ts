import { defineConfig } from "vite";

// Конфиг по рекомендациям Tauri: фиксированный порт, без очистки терминала.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome105",
    outDir: "dist",
  },
});
