/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        'kur-bg': '#070b14',
        'kur-bg-card': '#0f1626',
        'kur-bg-hover': '#17203a',
        'kur-border': '#243354',
        'kur-text': '#e6edf3',
        'kur-text-muted': '#8b9bb4',
        'kur-accent': '#58a6ff',
        'kur-green': '#3fb950',
        'kur-red': '#f85149',
        'kur-yellow': '#d29922',
        'kur-purple': '#bc8cff',
        'kur-orange': '#f0883e',
        // Novos acentos neon (direção tech/futurista)
        'kur-cyan': '#22d3ee',
        'kur-violet': '#a855f7',
        'kur-pink': '#ec4899',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // Escala de texto ampliada para leitura confortável.
      // Ajuste global: mexer aqui muda o app inteiro.
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }], // 12px -> 14px
        sm: ['0.9375rem', { lineHeight: '1.4rem' }], // 14px -> 15px
        base: ['1.0625rem', { lineHeight: '1.65rem' }], // 16px -> 17px
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(88, 166, 255, 0.45)',
        'glow-sm': '0 0 14px -4px rgba(88, 166, 255, 0.40)',
        'glow-violet': '0 0 26px -6px rgba(168, 85, 247, 0.55)',
        'glow-green': '0 0 18px -6px rgba(63, 185, 80, 0.55)',
        'glow-cyan': '0 0 22px -6px rgba(34, 211, 238, 0.50)',
        card: '0 12px 40px -20px rgba(0, 0, 0, 0.9)',
      },
      backgroundImage: {
        'kur-gradient': 'linear-gradient(135deg, #58a6ff 0%, #a855f7 100%)',
        'kur-gradient-cyan': 'linear-gradient(135deg, #22d3ee 0%, #58a6ff 100%)',
        'kur-gradient-soft':
          'linear-gradient(135deg, rgba(88, 166, 255, 0.16) 0%, rgba(168, 85, 247, 0.16) 100%)',
        'grid-tech':
          'linear-gradient(rgba(88, 166, 255, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(88, 166, 255, 0.06) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: '44px 44px',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.65' },
          '50%': { opacity: '1' },
        },
        'grid-pan': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '44px 44px' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        float: 'float 7s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 3.5s ease-in-out infinite',
        'grid-pan': 'grid-pan 24s linear infinite',
        'fade-up': 'fade-up 0.4s ease-out both',
      },
    },
  },
  plugins: [],
}
