import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import BackButton from '@/components/shared/BackButton';
import PageContainer from '@/components/layout/PageContainer';
import CaptureCard from '@/components/observatory/CaptureCard';
import { recentCaptures } from '@/lib/observatory/gallery';

export const metadata: Metadata = {
  title: 'Captures — Stellar Observatory',
  description:
    'Every frame the network has taken, with the instrument that took it and where it came from.',
};

// The gallery grows a row at a time, not a request at a time.
export const revalidate = 120;

export default async function CapturesPage() {
  const t = await getTranslations('observatory.captures');
  const captures = await recentCaptures(24);
  const instrument = captures.filter((c) => c.provenance === 'instrument').length;

  return (
    <PageContainer variant="wide" className="py-6 sm:py-10">
      <BackButton />

      <header className="mt-8 max-w-2xl">
        {/* No photographic hero here on purpose: a NASA picture over "what the
            network has photographed" would imply the very thing this page
            exists to disprove. The frames arrive at first light. */}
        <h1 className="obs-h1">{t('title')}</h1>
        <p className="obs-lede max-w-2xl">{t('intro')}</p>
        <Link
          href="/observatory/how-it-works"
          className="mt-5 inline-block text-sm underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          {t('howLink')}
        </Link>
      </header>

      {captures.length === 0 ? (
        <EmptyGallery />
      ) : (
        <>
          <p className="mt-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t.rich('count', {
              count: captures.length,
              instrument,
              n: (chunks) => (
                <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                  {chunks}
                </span>
              ),
            })}
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {captures.map((capture) => (
              <CaptureCard key={capture.id} capture={capture} />
            ))}
          </div>
        </>
      )}
    </PageContainer>
  );
}

/**
 * The empty state says why it is empty, which is the only interesting thing
 * about it. A gallery seeded with frames nobody asked for would be the July
 * mistake in a friendlier shape.
 */
async function EmptyGallery() {
  const t = await getTranslations('observatory.captures');

  return (
    <section
      className="obs-section border p-6"
      style={{ borderColor: 'var(--obs-rule)', background: 'var(--surface)' }}
    >
      <h2 className="obs-h2">{t('emptyTitle')}</h2>
      <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
        {t('emptyWhy')}
      </p>
      <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
        {t('emptyNext')}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href="/observatory" className="obs-action obs-action--primary">
          {t('book')}
        </Link>
        <Link href="/observatory/simulator" className="obs-action">
          {t('simulator')}
        </Link>
      </div>
    </section>
  );
}
