'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CloudSun, Satellite, Home, Telescope, ShoppingBag, LayoutGrid } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Tab = { href: string; labelKey: string; icon: LucideIcon };

const TABS: Tab[] = [
  { href: '/sky',         labelKey: 'sky',         icon: CloudSun },
  { href: '/missions',    labelKey: 'missions',    icon: Satellite },
  { href: '/',            labelKey: 'home',        icon: Home },
  { href: '/observatory', labelKey: 'observatory', icon: Telescope },
  { href: '/marketplace', labelKey: 'marketplace', icon: ShoppingBag },
  { href: '/hub',         labelKey: 'hub',         icon: LayoutGrid },
];

export default function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const nav = (
    <nav
      data-stellar-chrome="bottom"
      aria-label="Main navigation"
      className="stellar-bottomnav sm:hidden fixed bottom-0 left-0 right-0 z-50"
      style={{
        paddingBottom: 'max(env(safe-area-inset-bottom), 10px)',
      }}
    >
      <style>{`
        .stellar-bottomnav { background: #050812; border-top: 1px solid rgba(255,255,255,0.06); }
        [data-theme="light"] .stellar-bottomnav { background: rgba(237,240,247,0.97); border-top: 1px solid rgba(15,23,42,0.08); }
      `}</style>
      <div
        style={{
          display: 'flex',
          height: 70,
          padding: '6px 4px 0',
        }}
      >
        {TABS.map(tab => {
          const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-label={t(tab.labelKey)}
              aria-current={isActive ? 'page' : undefined}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 4,
                paddingTop: 6,
                textDecoration: 'none',
                WebkitTapHighlightColor: 'transparent',
                position: 'relative',
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: 44,
                  height: 30,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon
                  size={22}
                  strokeWidth={isActive ? 2.2 : 1.7}
                  color={isActive ? 'var(--accent-text)' : 'var(--text-primary)'}
                />
              </div>

              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 9.5,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--stl-text-bright)' : 'var(--text-primary)',
                  letterSpacing: '0.01em',
                  lineHeight: 1,
                  transition: 'color 0.2s ease',
                }}
              >
                {t(tab.labelKey)}
              </span>

              {isActive && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 32,
                    height: 2,
                    borderRadius: 2,
                    background: 'var(--stl-gold)',
                  }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );

  if (!mounted) return null;

  // Keep the tab bar attached to the viewport even when a feature opens its
  // own full-screen scroll container or temporarily scroll-locks the page.
  return createPortal(nav, document.body);
}
