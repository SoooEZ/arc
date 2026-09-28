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
    rolldownOptions: {
      output: {
        codeSplitting: {
          // A group also takes the dependencies of its modules; higher priority
          // claims them first. React must not ride in the editor-only flow chunk,
          // or every route would download React Flow and its stylesheet.
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 3,
            },
            {
              name: "mui",
              test: /node_modules[\\/](@mui|@emotion)[\\/]/,
              priority: 2,
            },
            {
              name: "flow",
              test: /node_modules[\\/]@xyflow[\\/]/,
              priority: 1,
            },
          ],
        },
      },
    },
  },
});
