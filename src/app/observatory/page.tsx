import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import BackButton from '@/components/shared/BackButton';
import PageContainer from '@/components/layout/PageContainer';
import NodeCard from '@/components/observatory/NodeCard';
import { getNodesWithReadiness } from '@/lib/observatory/nodes';

export const metadata: Metadata = {
  title: 'Observatory — Stellar',
  description:
    'Book time on a real telescope. Watch a real object, live, through an instrument somewhere the sky is clear.',
};

// Readiness depends on the Sun and the weather, so the page cannot be static —
// but it changes on the scale of minutes, not requests.
export const revalidate = 300;

export default async function ObservatoryPage() {
  const t = await getTranslations('observatory.network');
  const nodes = await getNodesWithReadiness();
  const observable = nodes.filter((n) => n.readiness.state === 'online').length;

  return (
    <>
      <section className="obs-hero">
        <Image
          src="/hero/hero-milkyway.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="obs-hero__img"
        />
        <PageContainer variant="wide" className="obs-hero__body">
          <BackButton />
          <h1 className="obs-h1 mt-6">{t('title')}</h1>
          <p className="obs-lede">{t('lead')}</p>
        </PageContainer>
        <span className="obs-hero__credit">{t('heroCredit')}</span>
      </section>

      <PageContainer variant="wide" className="pb-16">
        <nav className="mt-6">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link href="/observatory/how-it-works" className="underline" style={{ color: 'var(--text-secondary)' }}>
            {t('proofLink')}
          </Link>
          <Link href="/observatory/captures" className="underline" style={{ color: 'var(--text-secondary)' }}>
            {t('capturesLink')}
          </Link>
          <Link href="/observatory/requests" className="underline" style={{ color: 'var(--text-secondary)' }}>
            {t('requestsLink')}
          </Link>
          <Link href="/first-light" className="underline" style={{ color: 'var(--text-secondary)' }}>
            {t('firstLightLink')}
          </Link>
          </div>
        </nav>

      <p className="obs-label mt-8">
        {t('instrumentCount', { count: nodes.length })} · {t('observableNow', { count: observable })}
      </p>

      {nodes.length === 0 ? (
        <p className="obs-panel mt-6 p-5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('empty')}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {nodes.map((node) => (
            <NodeCard key={node.id} node={node} />
          ))}
        </div>
      )}

      <div className="obs-section grid gap-4 md:grid-cols-2">
        <section className="obs-panel flex flex-col p-5">
          <h2 className="obs-h2">{t('tryTitle')}</h2>
          <p className="mt-2 flex-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('tryLead')}
          </p>
          <Link href="/observatory/simulator" className="obs-action obs-action--primary mt-4 self-start">
            {t('tryCta')}
          </Link>
        </section>

        <section className="obs-panel flex flex-col p-5">
          <h2 className="obs-h2">{t('ownerTitle')}</h2>
          <p className="mt-2 flex-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('ownerLead')}
          </p>
          <Link href="/observatory/operator" className="obs-action obs-action--primary mt-4 self-start">
            {t('ownerCta')}
          </Link>
        </section>
      </div>
      </PageContainer>
    </>
  );
}
