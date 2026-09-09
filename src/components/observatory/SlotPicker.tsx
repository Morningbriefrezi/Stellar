'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePrivy } from '@privy-io/react-auth';
import { AuthModal } from '@/components/auth/AuthModal';
import { useStellarUser } from '@/hooks/useStellarUser';
import type { Slot } from '@/lib/observatory/availability';

type BookableSlot = Slot & { taken: boolean; mine: boolean; sessionId: string | null };

type Props = {
  nodeId: string;
  timezone: string;
  sessionMinutes: number;
  priceGel: number;
};

/** Site-local clock — a slot is quoted in the sky's time, not the visitor's. */
function siteClock(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

function nightLabel(night: string, timezone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${night}T12:00:00Z`));
}

/** The visitor's own clock, for the hover title — most people are in one zone, some are not. */
function localClock(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export default function SlotPicker({ nodeId, timezone, sessionMinutes, priceGel }: Props) {
  const t = useTranslations('observatory.slots');
  const locale = useLocale();
  const { getAccessToken } = usePrivy();
  const { authenticated } = useStellarUser();

  const [slots, setSlots] = useState<BookableSlot[] | null>(null);
  const [holdsKnown, setHoldsKnown] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const token = authenticated ? await getAccessToken() : null;
      const res = await fetch(`/api/observatory/slots?node=${encodeURIComponent(nodeId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setSlots(data.slots as BookableSlot[]);
      setHoldsKnown(data.holdsKnown !== false);
    } catch {
      setSlots([]);
      setError(t('loadFailed'));
    }
  }, [authenticated, getAccessToken, nodeId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (slot: BookableSlot) => {
    if (!authenticated) {
      setAuthOpen(true);
      return;
    }

    setPending(slot.id);
    setError('');
    try {
      const token = await getAccessToken();
      const res = slot.mine
        ? await fetch(`/api/observatory/book?slot=${encodeURIComponent(slot.id)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          })
        : await fetch('/api/observatory/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ slotId: slot.id }),
          });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t('actionFailed'));
      }
      await load();
    } catch {
      setError(t('networkError'));
    } finally {
      setPending(null);
    }
  };

  // A bare sentence here reads as "there are no slots". A grid the shape of
  // the real one reads as "they are coming".
  if (slots === null) {
    return (
      <div className="mt-4">
        <p className="obs-label">{t('loading')}</p>
        <div className="obs-slots mt-3" aria-hidden="true">
          {Array.from({ length: 11 }, (_, i) => (
            <span key={i} className="obs-slot obs-slot--ghost" />
          ))}
        </div>
      </div>
    );
  }

  const nights = [...new Set(slots.map((s) => s.night))];
  const cloudByNight = new Map(
    nights.map((night) => {
      const read = slots
        .filter((s) => s.night === night && s.cloudCover !== null)
        .map((s) => s.cloudCover as number);
      return [night, read.length ? read.reduce((a, b) => a + b, 0) / read.length : null];
    }),
  );
  // Four nights of identical tiles hide the only thing worth knowing: which
  // one to pick. The clearest gets named; the rest keep their numbers.
  const rated = [...cloudByNight].filter(([, c]) => c !== null) as [string, number][];
  const clearestNight = rated.length > 1
    ? rated.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0]
    : null;

  return (
    <div className="mt-4">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {t.rich('terms', {
          minutes: sessionMinutes,
          price: priceGel,
          n: (chunks) => (
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
              {chunks}
            </span>
          ),
        })}
      </p>

      {!holdsKnown && (
        <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('holdsOffline')}
        </p>
      )}

      {error && (
        <p className="mt-3 text-sm" style={{ color: 'var(--no)' }} role="alert">
          {error}
        </p>
      )}

      {nights.length === 0 ? (
        <p
          className="mt-4 rounded-xl border p-5 text-sm"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface)',
            color: 'var(--text-secondary)',
          }}
        >
          {t('empty')}
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-6">
          {nights.map((night) => (
            <section key={night}>
              <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="obs-label">
                  {t('nightHeading', { night: nightLabel(night, timezone, locale) })}
                </span>
                {cloudByNight.get(night) !== null && (
                  <span className="obs-label" style={{ color: 'var(--text-secondary)' }}>
                    {t('avgCloud', { percent: Math.round(cloudByNight.get(night) as number) })}
                  </span>
                )}
                {night === clearestNight && (
                  <span className="obs-slot__flag">{t('clearest')}</span>
                )}
              </h3>
              <div className="obs-slots mt-3">
                {slots
                  .filter((s) => s.night === night)
                  .map((slot) => (
                    <SlotTile
                      key={slot.id}
                      slot={slot}
                      timezone={timezone}
                      busy={pending === slot.id}
                      onSelect={() => act(slot)}
                    />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}

function SlotTile({
  slot,
  timezone,
  busy,
  onSelect,
}: {
  slot: BookableSlot;
  timezone: string;
  busy: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('observatory.slots');
  const taken = slot.taken && !slot.mine;
  const clouded = slot.cloudCover !== null && slot.cloudCover > 70;

  const shell = [
    'obs-slot',
    slot.mine && 'obs-slot--mine',
    taken && 'obs-slot--taken',
    clouded && !taken && !slot.mine && 'obs-slot--clouded',
  ]
    .filter(Boolean)
    .join(' ');
  const clock = <span className="obs-slot__clock">{siteClock(slot.startsAt, timezone)}</span>;

  // The cloud figure is the only thing separating one slot from the next, so
  // it gets a length as well as a number — a row of bars is scannable in a way
  // that a row of percentages is not.
  const cloudBar =
    slot.cloudCover === null ? null : (
      <span className="obs-slot__bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.round(slot.cloudCover))}%` }} />
      </span>
    );

  // A held slot carries two actions, so it cannot be one button — nesting a
  // control inside a control is invalid, and the whole tile is no longer a
  // single choice.
  if (slot.mine) {
    return (
      <div className={shell}>
        {clock}
        <span className="flex items-center gap-3 text-xs">
          <Link
            href={`/observatory/session/${slot.sessionId}`}
            className="underline"
            style={{ color: 'var(--yes)' }}
          >
            {t('openSession')}
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={onSelect}
            className="underline disabled:cursor-not-allowed"
            // The global 44px control floor would stretch this line into a pill.
            style={{ color: 'var(--text-muted)', minHeight: 0, padding: 0 }}
          >
            {busy ? t('releasing') : t('release')}
          </button>
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={taken || busy}
      onClick={onSelect}
      title={localClock(slot.startsAt)}
      className={shell}
    >
      {clock}
      <span className="obs-slot__meta">
        {taken
          ? t('taken')
          : busy
            ? t('holding')
            : slot.cloudCover === null
              ? t('free')
              : t('cloud', { percent: Math.round(slot.cloudCover) })}
      </span>
      {!taken && !busy && cloudBar}
      {clouded && !taken && <span className="obs-slot__warn">{t('likelyClouded')}</span>}
    </button>
  );
}
