/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'care-blue': '#1A4598',
        'teal-green': '#00BFA5',
        'interactive-blue': '#2962FF',
        'mist-white': '#FFFFFF',
        'cloud-grey': '#F5F7FA',
        'steel-grey': '#D4D9E1',
        'ink-black': '#111827',
        'success': '#00CB53',
        'warning': '#FFC107',
        'error': '#D32F2F',
        'information': '#0288D1',
        'active': '#00E5FF',
      },
      fontFamily: {
        'montserrat': ['Montserrat_400Regular'],
        'montserrat-medium': ['Montserrat_500Medium'],
        'montserrat-semibold': ['Montserrat_600SemiBold'],
        'montserrat-bold': ['Montserrat_700Bold'],
      },
      fontSize: {
        'h1': ['32px', { lineHeight: '1.2', fontWeight: '700' }],
        'h2': ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'h3': ['20px', { lineHeight: '1.3', fontWeight: '600' }],
        'h4': ['16px', { lineHeight: '1.4', fontWeight: '500' }],
        'body-lg': ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-sm': ['13px', { lineHeight: '1.6', fontWeight: '400' }],
        'caption': ['12px', { lineHeight: '1.4', fontWeight: '400' }],
      },
      borderRadius: {
        'card': '16px',
        'button': '16px',
      },
      height: {
        'btn': '52px',
      },
    },
  },
  plugins: [],
};
