import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import BackButton from '@/components/shared/BackButton';
import PageContainer from '@/components/layout/PageContainer';
import ReadinessBadge from '@/components/observatory/ReadinessBadge';
import SlotPicker from '@/components/observatory/SlotPicker';
import { adapterFor, getNode } from '@/lib/observatory/nodes';
import { fieldOfView, focalRatio, resolvingPowerArcsec } from '@/lib/observatory/optics';

type Params = { params: Promise<{ nodeId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const node = getNode((await params).nodeId);
  if (!node) return { title: 'Instrument not found — Stellar' };

  return {
    title: `${node.name} — Stellar Observatory`,
    description: `${node.instrument.optics} and a ${node.instrument.camera} in ${node.site}. See when the sky is dark over the site and hold a slot.`,
  };
}

// Readiness moves with the Sun and the weather, not with the request.
export const revalidate = 300;

export default async function NodePage({ params }: Params) {
  const node = getNode((await params).nodeId);
  if (!node) notFound();

  const t = await getTranslations('observatory.node');
  const tReady = await getTranslations('observatory.readiness');
  // adapterFor, not a fresh simulator: a node wired to real hardware must not
  // have its readiness answered by the simulator standing in for it.
  const readiness = await adapterFor(node).getReadiness(node);
  const { instrument } = node;
  const fov = fieldOfView(instrument);

  return (
    <PageContainer variant="wide" className="py-6 sm:py-10">
      <BackButton />

      <header className="mt-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="obs-h1">{node.name}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('header', {
              site: node.site,
              bortle: node.bortle,
              timezone: node.timezone.replace('_', ' '),
            })}
          </p>
        </div>
        <ReadinessBadge readiness={readiness} />
      </header>

      {readiness.detail && (
        <p className="mt-3 max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
          {tReady(readiness.detail.key, readiness.detail.values)}
        </p>
      )}

      <section className="obs-panel obs-section">
        <div className="obs-panel__bar">
          <h2 className="obs-panel__title" style={{ color: 'var(--text-primary)' }}>
            {t('instrumentTitle')}
          </h2>
          <span className="obs-panel__title">{node.instrument.optics}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-4">
          <Spec label={t('optics')} value={instrument.optics} />
          <Spec label={t('camera')} value={instrument.camera} />
          <Spec label={t('aperture')} value={`${instrument.apertureMm} mm`} mono />
          <Spec label={t('focalRatio')} value={`f/${focalRatio(instrument).toFixed(0)}`} mono />
          <Spec
            label={t('fieldOfView')}
            value={`${fov.widthArcmin.toFixed(1)}′ × ${fov.heightArcmin.toFixed(1)}′`}
            mono
          />
          <Spec label={t('plateScale')} value={`${fov.plateScaleArcsecPx.toFixed(2)}″/px`} mono />
          <Spec
            label={t('resolvesTo')}
            value={`${resolvingPowerArcsec(instrument).toFixed(2)}″`}
            mono
          />
          <Spec label={t('mount')} value={instrument.mount} />
        </dl>
        <p
          className="border-t px-4 py-3 text-sm"
          style={{ borderColor: 'var(--obs-rule)', color: 'var(--text-secondary)' }}
        >
          {t('bestForLong', {
            targets: instrument.suitedTo.map((k) => t(`target${k}`)).join(' · '),
          })}
        </p>
      </section>

      <section className="obs-panel mt-4">
        <div className="obs-panel__bar">
          <h2 className="obs-panel__title" style={{ color: 'var(--text-primary)' }}>
            {t('holdTitle')}
          </h2>
          <span className="obs-panel__title">
            {t('price', { price: node.priceGel, minutes: node.sessionMinutes })}
          </span>
        </div>
        <div className="p-4">
        <p className="max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('holdIntro', { site: node.site })}{' '}
          {node.status !== 'active' && t('commissioning', { name: node.name })}
        </p>

        <SlotPicker
          nodeId={node.id}
          timezone={node.timezone}
          sessionMinutes={node.sessionMinutes}
          priceGel={node.priceGel}
        />
        </div>
      </section>

      {/* The two ways to use the instrument without holding a slot, side by
          side: stacked full-width they left a column of empty page beside them. */}
      <div className="obs-section grid gap-4 md:grid-cols-2">
        <section className="obs-panel flex flex-col p-4">
          <h2 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
            {t('simTitle')}
          </h2>
          <p className="mt-2 flex-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('simBody')}
          </p>
          <Link href="/observatory/simulator" className="obs-action obs-action--primary mt-4 self-start">
            {t('simCta')}
          </Link>
        </section>

        <section className="obs-panel flex flex-col p-4">
          <h2 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
            {t('requestTitle')}
          </h2>
          <p className="mt-2 flex-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('requestBody')}
          </p>
          <Link href="/observatory/requests" className="obs-action obs-action--primary mt-4 self-start">
            {t('requestCta')}
          </Link>
        </section>
      </div>
    </PageContainer>
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
