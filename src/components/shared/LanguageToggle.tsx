'use client';

import { useCallback } from 'react';
import { useLocale } from 'next-intl';

type Locale = 'en' | 'ka';

export default function LanguageToggle() {
  // Reading document.documentElement.lang made this render 'en' on the server
  // and 'ka' in the browser, which failed hydration on every Georgian page and
  // took the whole tree down with it. useLocale() is the same value on both
  // sides because the provider is given it.
  const currentLocale = useLocale() as Locale;

  const handleToggle = useCallback(async () => {
    const newLocale: Locale = currentLocale === 'en' ? 'ka' : 'en';

    // Set the cookie
    document.cookie = `stellar_locale=${newLocale}; path=/; max-age=${60 * 60 * 24 * 365}`;

    // Reload page to apply new locale
    window.location.reload();
  }, [currentLocale]);

  const displayLabel = currentLocale === 'en' ? 'GE' : 'EN';

  return (
    <button
      onClick={handleToggle}
      className="language-toggle nav-icon-btn"
      aria-label={`Switch to ${currentLocale === 'en' ? 'Georgian' : 'English'}`}
      title={`Switch to ${currentLocale === 'en' ? 'Georgian' : 'English'}`}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        color: 'var(--text-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.04em',
        transition: 'all 0.15s ease',
      }}
    >
      {displayLabel}
    </button>
  );
}
