import type { Config } from "tailwindcss";

// Design system tokens from §28.2. One surface, panels lift by tone, one accent, four verdict colours.
const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#141416",
        panel: "#1C1C20",
        panel2: "#232328",
        hairline: "#2A2A30",
        ink: "#E8E8EC",
        muted: "#8B8B95",
        faint: "#5A5A64",
        accent: "#3D7EFF",
        approved: "#2E9E5B",
        minor: "#C9A227",
        major: "#D1742F",
        rejected: "#C2453F",
        amber: "#C9A227",
      },
      fontFamily: {
        ui: ["Inter", "system-ui", "sans-serif"],
        deva: ["'Noto Sans Devanagari'", "sans-serif"],
        beng: ["'Noto Sans Bengali'", "sans-serif"],
      },
      fontSize: {
        ui: ["14px", "20px"],
      },
    },
  },
  plugins: [],
};
export default config;
