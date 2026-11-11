/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Interface and every figure in a table: clear, with true tabular numerals.
        sans: ['"IBM Plex Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        // Section headings: a text-weight Caslon that holds up at small sizes.
        serif: ['"Libre Caslon Text"', "ui-serif", "Georgia", "serif"],
        // The few large figures: a display Caslon with engraved hairlines.
        display: ['"Libre Caslon Display"', '"Libre Caslon Text"', "ui-serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
