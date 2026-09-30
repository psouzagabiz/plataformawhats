import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        vesper: {
          DEFAULT: "#14213D",
          deep: "#0E1830",
          surface: "#1B2A4A",
          line: "#2C3E63",
        },
        candle: {
          DEFAULT: "#C9973F",
          soft: "#E0B770",
          dim: "#8A6A2B",
        },
        ember: {
          DEFAULT: "#B4472A",
          soft: "#D97052",
        },
        parchment: {
          DEFAULT: "#F3EFE4",
          card: "#FBF9F3",
          line: "#E4DDC9",
        },
        ink: {
          DEFAULT: "#1D1B16",
          soft: "#514C3F",
          faint: "#8A8371",
        },
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        sans: ["var(--font-public-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(29, 27, 22, 0.06), 0 8px 24px -12px rgba(29, 27, 22, 0.18)",
        ledger: "0 20px 60px -20px rgba(14, 24, 48, 0.45)",
      },
      keyframes: {
        "slide-in-stack": {
          "0%": { opacity: "0", transform: "translateY(14px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "bell-ring": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "15%": { transform: "rotate(14deg)" },
          "30%": { transform: "rotate(-12deg)" },
          "45%": { transform: "rotate(8deg)" },
          "60%": { transform: "rotate(-6deg)" },
          "75%": { transform: "rotate(2deg)" },
        },
      },
      animation: {
        "slide-in-stack": "slide-in-stack 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "bell-ring": "bell-ring 0.6s ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;
