/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base:         "var(--bg-base)",
        surface:      "var(--bg-surface)",
        elevated:     "var(--bg-elevated)",
        accent:       "var(--accent)",
        "accent-dim": "var(--accent-dim)",
      },
      fontFamily: {
        mono:    ["IBM Plex Mono", "Fira Code", "monospace"],
        display: ["Fraunces", "Georgia", "serif"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
    },
  },
  plugins: [],
  // Primary styling is CSS variables in index.css — disable Tailwind preflight
  // to avoid conflicts with the custom reset.
  corePlugins: { preflight: false },
};
