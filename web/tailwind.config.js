/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        content: {
          background: 'var(--content-background)',
        },
      },
    },
  },
  plugins: [],
};
