/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/popup/**/*.{ts,tsx,html}',
    './src/options/**/*.{ts,tsx,html}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Hiragino Sans"',
          '"Noto Sans JP"',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
