/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#070b14',
        panel: '#0f1726',
        panelAlt: '#121d31',
        line: '#1c2840',
        text: '#e5f0ff',
        muted: '#7f8da9',
        long: '#22c55e',
        short: '#f43f5e',
        wait: '#94a3b8',
        accent: '#38bdf8',
        amber: '#f59e0b',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(56, 189, 248, 0.15), 0 20px 40px rgba(7, 11, 20, 0.45)',
      },
      backgroundImage: {
        grid:
          'linear-gradient(rgba(56,189,248,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.08) 1px, transparent 1px)',
      },
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
