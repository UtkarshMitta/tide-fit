import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        deep: "#050b16",
        tide: {
          50: "#eefcfb",
          100: "#d4f7f6",
          200: "#aeeeee",
          300: "#76dfe1",
          400: "#38c7cd",
          500: "#1eaab3",
          600: "#158890",
          700: "#166c74",
          800: "#17565e",
          900: "#17484f",
        },
      },
      backgroundImage: {
        "tide-glow":
          "radial-gradient(60rem 40rem at 12% -10%, rgba(30,170,179,0.18), transparent 60%), radial-gradient(50rem 30rem at 90% 0%, rgba(56,199,205,0.10), transparent 55%)",
      },
      fontFamily: {
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;
