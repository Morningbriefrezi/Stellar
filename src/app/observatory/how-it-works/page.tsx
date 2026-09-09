import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import BackButton from '@/components/shared/BackButton';
import PageContainer from '@/components/layout/PageContainer';
import { NODES, adapterFor } from '@/lib/observatory/nodes';

export const metadata: Metadata = {
  title: 'How a capture is proved — Stellar Observatory',
  description:
    'What happens between a mount slewing and a record on chain, and why a simulated frame can never mint, earn or be logged as an observation.',
};

/**
 * The chain of custody, written from the code that enforces it.
 *
 * Every claim on this page names the function that makes it true. That is the
 * point: a provenance story a reader cannot check is marketing. If one of
 * these steps is refactored away, this page is wrong and should be changed
 * with it. The prose itself lives under observatory.howItWorks in the message
 * files, because the claims have to hold in Georgian too.
 */

const STEP_KEYS = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'] as const;

const REFUSAL_KEYS = ['refusalMint', 'refusalStar', 'refusalLog', 'refusalSell'] as const;

export default async function HowItWorksPage() {
  const t = await getTranslations('observatory.howItWorks');
  const nodes = NODES;
  const provenances = await Promise.all(
    nodes.map((node) => adapterFor(node).provenanceNow(node)),
  );
  const live = provenances.filter((p) => p === 'instrument');

  return (
    <PageContainer variant="wide" className="py-6 sm:py-10">
      <BackButton />

      <header className="mt-8 max-w-2xl">
        <h1 className="obs-h1">{t('title')}</h1>
        <p className="obs-lede max-w-2xl">{t('intro')}</p>
      </header>

      <ol className="obs-section flex flex-col">
        {STEP_KEYS.map((key, i) => (
          <li
            key={key}
            className="grid gap-x-4 gap-y-2 border-t py-5 sm:grid-cols-[3rem_minmax(0,1fr)]"
            style={{ borderColor: 'var(--obs-rule)' }}
          >
            <span className="obs-label" style={{ paddingTop: '0.2rem' }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
                  {t(`${key}Title`)}
                </h2>
                <span className="obs-label">{t(`${key}Where`)}</span>
              </div>
              <p className="max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t(`${key}Body`)}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <section
        className="obs-section border p-6"
        style={{ borderColor: 'var(--obs-rule-strong)', background: 'var(--surface)' }}
      >
        <h2 className="obs-h2">{t('refusalsTitle')}</h2>
        <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('refusalsIntro')}
        </p>
        <ul className="mt-4 max-w-2xl">
          {REFUSAL_KEYS.map((key) => (
            <li
              key={key}
              className="flex items-baseline gap-3 border-t py-2 text-sm"
              style={{ borderColor: 'var(--obs-rule)', color: 'var(--text-secondary)' }}
            >
              <span className="obs-label" style={{ color: 'var(--no)' }}>
                {t('refusalNo')}
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
        <p className="mt-3 max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('refusalsNote')}
        </p>
      </section>

      <section className="obs-section max-w-2xl">
        <h2 className="obs-h2">{t('whyTitle')}</h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t.rich('whyP1', {
            m: (chunks) => <span className="font-mono">{chunks}</span>,
          })}
        </p>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('whyP2')}
        </p>
      </section>

      <section
        className="obs-section border p-6"
        style={{ borderColor: 'var(--obs-rule)', background: 'var(--surface)' }}
      >
        <h2 className="obs-h2">{t('tonightTitle')}</h2>
        <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t.rich('tonightCount', {
            live: live.length,
            total: nodes.length,
            n: (chunks) => (
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                {chunks}
              </span>
            ),
          })}{' '}
          {live.length === 0 ? t('tonightWaiting') : t('tonightMixed')}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/observatory/simulator"
            className="inline-block rounded-md border px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--accent-border)',
              background: 'var(--accent-dim)',
              color: 'var(--accent-text)',
            }}
          >
            {t('simulator')}
          </Link>
          <Link
            href="/observatory"
            className="inline-block rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--obs-rule-strong)', color: 'var(--text-primary)' }}
          >
            {t('network')}
          </Link>
          <Link
            href="/observatory/captures"
            className="inline-block rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--obs-rule-strong)', color: 'var(--text-primary)' }}
          >
            {t('captures')}
          </Link>
        </div>
      </section>
    </PageContainer>
  );
}
