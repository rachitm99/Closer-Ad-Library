/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial'],
      },
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#eef2ff',
          500: '#4051f5',
          600: '#303fe1'
        },
      },
      boxShadow: {
        'card': '0 8px 30px rgba(16,24,40,0.06)'
      },
      borderRadius: {
        'lg': '12px'
      }
    }
  },
  plugins: [require('@tailwindcss/typography')],
}
