/** Manga workshop palette (§3.2) — light table, ink, registration marks. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#141210",
        paper: "#FBF8F1",
        vermilion: "#C8372A",
        indigo: "#2B3A5B",
        sage: "#7C8B6F",
        halftone: "#D8D2C6",
      },
      fontFamily: {
        display: ["'Bricolage Grotesque'", "sans-serif"],
        body: ["'Inter Tight'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
        deva: ["'Mukta'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
