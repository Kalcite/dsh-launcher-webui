import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发模式：Vite 跑在 5178，/api 与 /api/events 代理到后端 5177
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:5177"
    }
  },
  build: {
    outDir: "dist",
    sourcemap: false
  }
});
