import Link from 'next/link';
import { useTranslations } from 'next-intl';
import ReadinessBadge from './ReadinessBadge';
import type { NodeWithReadiness } from '@/lib/observatory/types';

const TIER_KEY = {
  first_party: 'tierFirstParty',
  kitted: 'tierKitted',
  byo: 'tierByo',
} as const;

/** Site-local time, so "next window" reads in the sky's clock, not the visitor's. */
function siteTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export default function NodeCard({ node }: { node: NodeWithReadiness }) {
  const t = useTranslations('observatory.node');
  const tReady = useTranslations('observatory.readiness');
  const { instrument, readiness } = node;

  return (
    <article className="obs-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
            {node.name}
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {node.site} · Bortle {node.bortle} · {t(TIER_KEY[node.tier])}
          </p>
        </div>
        <ReadinessBadge readiness={readiness} />
      </div>

      {readiness.detail && (
        <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {tReady(readiness.detail.key, readiness.detail.values)}
          {readiness.nextWindowAt && readiness.state !== 'online' && (
            <> {tReady('nextWindow', { time: siteTime(readiness.nextWindowAt, node.timezone) })}</>
          )}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Spec label={t('optics')} value={instrument.optics} />
        <Spec label={t('aperture')} value={`${instrument.apertureMm} mm`} mono />
        <Spec label={t('focalLength')} value={`${instrument.focalLengthMm} mm`} mono />
        <Spec label={t('camera')} value={instrument.camera} />
      </dl>

      <div
        className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('bestFor', {
            targets: instrument.suitedTo.map((k) => t(`target${k}`)).join(' · '),
          })}
        </p>
        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
          {t('price', { price: node.priceGel, minutes: node.sessionMinutes })}
        </p>
      </div>

      <Link
        href={`/observatory/${node.id}`}
        className="obs-action obs-action--primary mt-4 inline-block"
      >
        {t('open')}
      </Link>
    </article>
  );
}

function Spec({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm ${mono ? 'font-mono' : ''}`}
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </dd>
    </div>
  );
}
