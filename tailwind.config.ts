import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Preserve the Tailwind 3 palette used before the v4 migration.
        amber: { 400: "#fbbf24" },
        red: { 400: "#f87171", 500: "#ef4444" },
        zinc: {
          100: "#f4f4f5",
          200: "#e4e4e7",
          300: "#d4d4d8",
          400: "#a1a1aa",
          500: "#71717a",
          600: "#52525b",
        },
        dark: "#080A0D",
        light: "#F3F6FA",
        rouge: {
          DEFAULT: "#B8272C",
          10: "rgba(184, 39, 44, 0.10)",
          20: "rgba(184, 39, 44, 0.20)",
          50: "rgba(184, 39, 44, 0.50)",
          80: "rgba(184, 39, 44, 0.80)",
        },
        teal: {
          // Neutral terminal focus, deliberately away from the old
          // Mercedes-teal palette.
          DEFAULT: "#D7DEE8",
          10: "rgba(215, 222, 232, 0.10)",
          20: "rgba(215, 222, 232, 0.20)",
          50: "rgba(215, 222, 232, 0.50)",
          80: "rgba(215, 222, 232, 0.80)",
        },
        ambre: {
          DEFAULT: "#D4A72D",
          10: "rgba(212, 167, 45, 0.10)",
          20: "rgba(212, 167, 45, 0.20)",
          50: "rgba(212, 167, 45, 0.50)",
          80: "rgba(212, 167, 45, 0.80)",
        },
        gris: {
          DEFAULT: "#8D98A7",
          10: "rgba(141, 152, 167, 0.10)",
          20: "rgba(141, 152, 167, 0.20)",
          50: "rgba(141, 152, 167, 0.50)",
          80: "rgba(141, 152, 167, 0.80)",
        },
        // Surface hierarchy — Linear-inspired
        surface: {
          0: "#080A0D",
          1: "#0D1117",
          2: "#131922",
          3: "#1A2230",
          4: "#202A38",
        },
      },
      fontFamily: {
        serif: ['"GT Sectra"', "Georgia", '"Times New Roman"', "serif"],
        sans: ['"Sohne"', '"Suisse Intl"', "Inter", "-apple-system", '"Helvetica Neue"', "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "Consolas", "monospace"],
      },
      fontSize: {
        display: ["64px", { lineHeight: "64px", letterSpacing: "-0.022em" }],
        h1: ["48px", { lineHeight: "48px", letterSpacing: "-0.05em" }],
        h2: ["32px", { lineHeight: "40px", letterSpacing: "-0.04em" }],
        h3: ["20px", { lineHeight: "26px", letterSpacing: "-0.012em" }],
        h4: ["16px", { lineHeight: "24px" }],
        "body-lg": ["18px", { lineHeight: "28px", letterSpacing: "0.01em" }],
        body: ["16px", { lineHeight: "24px" }],
        "body-sm": ["14px", { lineHeight: "20px", letterSpacing: "-0.01em" }],
        caption: ["12px", { lineHeight: "16px" }],
        "data-xl": ["64px", { lineHeight: "64px", letterSpacing: "-0.03em" }],
        "data-lg": ["48px", { lineHeight: "48px", letterSpacing: "-0.02em" }],
        "data-md": ["32px", { lineHeight: "40px", letterSpacing: "-0.01em" }],
        "data-sm": ["20px", { lineHeight: "28px" }],
      },
      spacing: {
        0.5: "2px",
        1: "4px",
        1.5: "6px",
        2: "8px",
        2.5: "10px",
        3: "12px",
        3.5: "14px",
        4: "16px",
        5: "20px",
        6: "24px",
        7: "28px",
        8: "32px",
        9: "36px",
        10: "40px",
        12: "48px",
        14: "56px",
        16: "64px",
        18: "72px",
        20: "80px",
        24: "96px",
        28: "112px",
        32: "128px",
        36: "144px",
        40: "160px",
        48: "192px",
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
        pill: "9999px",
      },
      boxShadow: {
        // Raycast-inspired glow system
        "glow-ambient":
          "rgba(255, 255, 255, 0.03) 0px 0px 40px 20px, rgba(255, 255, 255, 0.3) 0px 0.5px 0px 0px inset",
        "glow-edge":
          "rgba(255, 255, 255, 0.19) 0px 0px 2px 0px, rgba(255, 255, 255, 0.1) 0px 0.5px 0px 0px inset",
        "glow-hover": "rgba(255, 255, 255, 0.12) 0px 0px 24px 0px",
        "glow-depth":
          "rgba(0, 0, 0, 0.4) 0px 4px 40px 8px, rgba(0, 0, 0, 0.8) 0px 0px 0px 0.5px, rgba(255, 255, 255, 0.3) 0px 0.5px 0px 0px inset",
        "glow-data": "rgba(215, 222, 232, 0.08) 0px 0px 24px 0px",
        "glow-accent": "rgba(184, 39, 44, 0.1) 0px 0px 20px 0px",
      },
      transitionDuration: {
        fast: "100ms",
        normal: "150ms",
        medium: "200ms",
        slow: "400ms",
        entrance: "700ms",
      },
      transitionTimingFunction: {
        snappy: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        overshoot: "cubic-bezier(0.23, 1, 0.32, 1)",
        entrance: "cubic-bezier(0.33, 0.12, 0.15, 1)",
        standard: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "count-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 400ms cubic-bezier(0.33, 0.12, 0.15, 1) forwards",
        "fade-in": "fade-in 400ms cubic-bezier(0.33, 0.12, 0.15, 1) forwards",
        "count-up": "count-up 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards",
      },
    },
  },
  plugins: [],
};

export default config;
