import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = `http://localhost:${process.env.ARC_API_PORT || "8080"}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": apiTarget,
      "/actuator": apiTarget,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@xyflow")) return "flow";
          if (id.includes("@mui") || id.includes("@emotion")) return "mui";
        },
      },
    },
  },
});
