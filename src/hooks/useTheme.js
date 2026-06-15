import { useState, useEffect } from 'react';

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
    } catch { /* noop */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'theme' && e.newValue) {
        setThemeState(e.newValue);
        document.documentElement.classList.toggle('dark', e.newValue === 'dark');
      }
    };

    const handleCustom = (e) => {
      setThemeState(e.detail);
      document.documentElement.classList.toggle('dark', e.detail === 'dark');
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('theme-change', handleCustom);

    // Sync on mount
    document.documentElement.classList.toggle('dark', theme === 'dark');

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('theme-change', handleCustom);
    };
  }, [theme]);

  const setTheme = (newTheme) => {
    const nextTheme = typeof newTheme === 'function' ? newTheme(theme) : newTheme;
    try {
      localStorage.setItem('theme', nextTheme);
    } catch { /* noop */ }
    setThemeState(nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    window.dispatchEvent(new CustomEvent('theme-change', { detail: nextTheme }));
  };

  return [theme, setTheme];
}
