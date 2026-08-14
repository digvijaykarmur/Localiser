/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
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
        display: ['"Bricolage Grotesque"', "serif"],
        ui: ['"Inter Tight"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};
