import { defineConfig } from "vite";

// The viewer lives in web/ and builds to dist/web. Transcripts in
// web/public/transcripts are copied as static files.
export default defineConfig({
  root: "web",
  base: "./",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});
