import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cdti: {
          50: "#fdf4f0",
          100: "#fbe4da",
          500: "#b5502f",
          600: "#943f24",
          700: "#78321d",
        },
      },
    },
  },
  plugins: [],
};

export default config;
