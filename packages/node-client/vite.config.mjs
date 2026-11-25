export default {
  build: {
    ssr: true,
    lib: {
      entry: "src/index.mjs",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["werift"],
    },
    outDir: "dist",
    emptyOutDir: true,
  },
};
