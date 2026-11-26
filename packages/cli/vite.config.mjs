export default {
  build: {
    ssr: true,
    lib: {
      entry: "src/cli.mjs",
      formats: ["es"],
      fileName: () => "cli.js",
    },
    rollupOptions: {
      external: ["werift"],
    },
    outDir: "dist",
    emptyOutDir: true,
  },
};
