// Shared design tokens exported via Module Federation.
// Plugin UIs import this to stay visually consistent with the Admin Console
// without bundling their own copy of Tailwind CSS variables.

export const tokens = {
  colors: {
    primary: '239 84.2% 67.1%',
    background: '0 0% 100%',
    foreground: '224 71.4% 4.1%',
    muted: '220 14.3% 95.9%',
    mutedForeground: '220 8.9% 46.1%',
    border: '220 13% 91%',
  },
  radius: {
    sm: '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
  },
} as const;
