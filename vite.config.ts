import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  server: { port: 5175, strictPort: true },
  // School Chromebooks are on Chrome 103. chrome96 keeps the bundle runnable there.
  build: {
    target: ["chrome96", "safari15", "firefox100"],
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        wall: resolve(root, "wall/index.html"),
      },
    },
  },
});
