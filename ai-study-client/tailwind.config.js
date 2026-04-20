/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        notion: {
          bg:             '#FFFFFF',
          bg_secondary:   '#F7F7F5',
          bg_hover:       '#EFEFED',
          text:           '#37352F',
          text_secondary: '#787774',
          text_tertiary:  '#C4C4C4',
          border:         '#E8E8E6',
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
