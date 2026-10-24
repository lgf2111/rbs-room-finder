/** @type {import('tailwindcss').Config} */
// Tailwind v3 config for the Nova content-script panel.
//
// The compiled stylesheet is injected inside a Shadow DOM, so we cannot rely on
// `:root` (inside a shadow root `:root` is the *document* root). shadcn's HSL
// theme variables are declared on `.nova-root` (the mount container) instead,
// in src/styles/tailwind.css.
module.exports = {
  // No `dark:` class toggling needed: the panel is dark-only for phase 1.
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Direct design tokens (his palette) for non-shadcn surfaces.
        surface: 'var(--rbs-surface)',
        surface2: 'var(--rbs-surface2)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        mono: ['var(--rbs-font-mono)'],
        sans: ['var(--rbs-font)'],
      },
      height: {
        control: 'var(--rbs-control-height)',
      },
    },
  },
  plugins: [],
};
