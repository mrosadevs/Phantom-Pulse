import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        // CSS variable-driven — switches between dark/light via [data-theme] on <html>
        bg: {
          base:     'rgb(var(--c-bg-base) / <alpha-value>)',
          surface:  'rgb(var(--c-bg-surface) / <alpha-value>)',
          elevated: 'rgb(var(--c-bg-elevated) / <alpha-value>)',
          overlay:  'rgb(var(--c-bg-overlay) / <alpha-value>)'
        },
        primary: {
          DEFAULT: 'rgb(var(--c-primary) / <alpha-value>)',
          hover:   'rgb(var(--c-primary-hover) / <alpha-value>)',
          muted:   'rgb(var(--c-primary-muted) / <alpha-value>)',
          glow:    'rgba(99, 102, 241, 0.3)'
        },
        success: {
          DEFAULT: 'rgb(var(--c-success) / <alpha-value>)',
          hover:   'rgb(var(--c-success-hover) / <alpha-value>)',
          muted:   'rgb(var(--c-success-muted) / <alpha-value>)',
          glow:    'rgba(16, 185, 129, 0.3)'
        },
        warning: {
          DEFAULT: 'rgb(var(--c-warning) / <alpha-value>)',
          hover:   'rgb(var(--c-warning-hover) / <alpha-value>)',
          muted:   'rgb(var(--c-warning-muted) / <alpha-value>)'
        },
        danger: {
          DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)',
          hover:   'rgb(var(--c-danger-hover) / <alpha-value>)',
          muted:   'rgb(var(--c-danger-muted) / <alpha-value>)'
        },
        text: {
          primary:   'rgb(var(--c-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--c-text-secondary) / <alpha-value>)',
          muted:     'rgb(var(--c-text-muted) / <alpha-value>)',
          disabled:  'rgb(var(--c-text-disabled) / <alpha-value>)'
        },
        border: {
          DEFAULT: 'rgb(var(--c-border) / <alpha-value>)',
          subtle:  'rgb(var(--c-border-subtle) / <alpha-value>)',
          bright:  'rgb(var(--c-border-bright) / <alpha-value>)'
        }
      },
      fontFamily: {
        sans:    ['Inter', 'ui-sans-serif', 'system-ui'],
        heading: ['Poppins', 'ui-sans-serif', 'system-ui'],
        mono:    ['JetBrains Mono', 'ui-monospace', 'monospace']
      },
      backgroundImage: {
        'gradient-primary':      'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
        'gradient-success':      'linear-gradient(135deg, #10B981 0%, #059669 100%)',
        'gradient-surface':      'linear-gradient(180deg, rgb(var(--c-bg-surface)) 0%, rgb(var(--c-bg-base)) 100%)',
        'gradient-glow-primary': 'radial-gradient(ellipse at center, rgba(99,102,241,0.15) 0%, transparent 70%)',
        'gradient-glow-success': 'radial-gradient(ellipse at center, rgba(16,185,129,0.15) 0%, transparent 70%)'
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(99, 102, 241, 0.35)',
        'glow-success': '0 0 20px rgba(16, 185, 129, 0.35)',
        'glow-sm':      '0 0 10px rgba(99, 102, 241, 0.2)',
        'card':         '0 4px 6px -1px rgba(0,0,0,0.15), 0 2px 4px -2px rgba(0,0,0,0.1)',
        'card-hover':   '0 20px 25px -5px rgba(0,0,0,0.2), 0 8px 10px -6px rgba(0,0,0,0.15)'
      },
      backdropBlur: {
        xs: '2px'
      },
      animation: {
        'fade-in':       'fadeIn 0.3s ease-out',
        'slide-up':      'slideUp 0.4s ease-out',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'glow-pulse':    'glowPulse 2s ease-in-out infinite',
        'shimmer':       'shimmer 2s linear infinite',
        'spin-slow':     'spin 3s linear infinite'
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        slideInLeft: {
          '0%':   { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' }
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 10px rgba(99,102,241,0.2)' },
          '50%':      { boxShadow: '0 0 30px rgba(99,102,241,0.5)' }
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      }
    }
  },
  plugins: []
}

export default config
