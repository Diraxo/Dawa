import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        'care-blue':  '#1A4598',
        'teal-green': '#00BFA5',
        'int-blue':   '#2962FF',
        'cloud-grey': '#F5F7FA',
        'steel-grey': '#D4D9E1',
        'ink-black':  '#111827',
        success:      '#00CB53',
        warning:      '#FFC107',
        danger:       '#D32F2F',
        info:         '#0288D1',
      },
      fontFamily: {
        montserrat: ['var(--font-montserrat)', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-hero':        'linear-gradient(to right, #1A4598, #00BFA5)',
        'gradient-interactive': 'linear-gradient(to right, #2962FF, #00BFA5)',
        'gradient-dark-bg':     'radial-gradient(ellipse at bottom left, #1A459880 0%, transparent 60%), radial-gradient(ellipse at top right, #00BFA580 0%, transparent 60%)',
      },
      animation: {
        'fade-up':    'fadeUp 0.7s ease-out forwards',
        'fade-in':    'fadeIn 0.5s ease-out forwards',
        'slide-left': 'slideLeft 0.6s ease-out forwards',
        'float':      'float 6s ease-in-out infinite',
        'shimmer':    'shimmer 2.5s linear infinite',
        'spin-slow':  'spin 12s linear infinite',
        'bounce-sm':  'bounceSm 2s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(32px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideLeft: {
          '0%':   { opacity: '0', transform: 'translateX(32px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-16px)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        bounceSm: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
      },
      boxShadow: {
        card:    '0 2px 16px rgba(0,0,0,0.06)',
        'card-lg': '0 8px 40px rgba(0,0,0,0.10)',
        blue:    '0 8px 32px rgba(26,69,152,0.22)',
        teal:    '0 8px 32px rgba(0,191,165,0.22)',
        glow:    '0 0 80px rgba(41,98,255,0.12)',
      },
    },
  },
  plugins: [],
};
export default config;
