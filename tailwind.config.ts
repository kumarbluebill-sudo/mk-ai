import type { Config } from "tailwindcss";

// "blue" is remapped to the MK brand green so every existing screen picks up the new look
// without touching its logic or markup.
const brand = {
  50: "#eef6f3",
  100: "#d6ebe3",
  200: "#aed6c7",
  300: "#7fbaa5",
  400: "#4f9a82",
  500: "#2f7d66",
  600: "#236654",
  700: "#1c5143",
  800: "#173f35",
  900: "#12332b",
  950: "#0a1f1a",
};

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: { fontFamily: { serif: ["DM Serif Display", "Georgia", "serif"] }, colors: { blue: brand, brand, gold: { 400: "#d4b57a", 500: "#ba9a64", 600: "#9c7f4d" } } } },
  plugins: [],
} satisfies Config;
