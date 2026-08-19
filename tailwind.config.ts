import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand — deep sea-green ink, drawn from Irish landscape, not generic SaaS blue
        brand: {
          25: "#F5FAF8",
          50: "#EAF5F1",
          100: "#D2EAE2",
          200: "#A6D5C6",
          300: "#6FB9A3",
          400: "#3D9A80",
          500: "#1E7D64",
          600: "#12654F",
          700: "#0E5241",
          800: "#0B4035",
          900: "#082E26",
          950: "#051F1A",
        },
        ink: {
          50: "#F7F7F5",
          100: "#EDEDEA",
          200: "#DCDCD7",
          300: "#B9B9B2",
          400: "#8E8E86",
          500: "#6B6B63",
          600: "#52524B",
          700: "#3E3E38",
          800: "#262622",
          900: "#171714",
          950: "#0D0D0B",
        },
        surface: {
          DEFAULT: "#FAFAF8",
          raised: "#FFFFFF",
          sunken: "#F3F3F0",
        },
        positive: {
          50: "#EDFAF2",
          100: "#D3F2E0",
          500: "#16A34A",
          600: "#15803D",
          700: "#166534",
        },
        negative: {
          50: "#FEF1F1",
          100: "#FDDEDE",
          500: "#DC2626",
          600: "#B91C1C",
          700: "#991B1B",
        },
        warn: {
          50: "#FFF8EB",
          100: "#FEEDC7",
          500: "#D97706",
          600: "#B45309",
          700: "#92400E",
        },
        ai: {
          50: "#F4F1FE",
          100: "#E7E0FD",
          200: "#D0C2FB",
          500: "#7C5CF5",
          600: "#6941E8",
          700: "#5730C9",
        },
      },
      fontFamily: {
        sans: ["Inter Variable", "Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(13 13 11 / 0.04), 0 1px 3px 0 rgb(13 13 11 / 0.06)",
        raised: "0 4px 12px -2px rgb(13 13 11 / 0.08), 0 2px 4px -1px rgb(13 13 11 / 0.04)",
        overlay: "0 20px 50px -12px rgb(13 13 11 / 0.25)",
      },
      borderRadius: {
        card: "0.75rem",
      },
      animation: {
        "fade-in": "fadeIn 0.15s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
