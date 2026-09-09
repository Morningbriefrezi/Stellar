import type { Metadata } from 'next';
import BackButton from '@/components/shared/BackButton';
import PageContainer from '@/components/layout/PageContainer';
import SessionConsole from '@/components/observatory/SessionConsole';
import { getNodesWithReadiness } from '@/lib/observatory/nodes';
import { fieldOfView } from '@/lib/observatory/optics';

export const metadata: Metadata = {
  title: 'Telescope simulator — Stellar',
  description:
    'Drive a simulated 150 mm telescope with real field of view, real slew times and a real safety envelope. Nothing here is a photograph presented as your own.',
};

export const revalidate = 300;

export default async function SimulatorPage() {
  const [node] = await getNodesWithReadiness();
  const fov = fieldOfView(node.instrument);

  return (
    <PageContainer variant="wide" className="py-6 sm:py-10">
      <BackButton />

      <header className="obs-panel mt-4">
        <div className="obs-panel__bar">
          <span className="flex items-center gap-2">
            <span className="obs-led obs-led--nominal" aria-hidden="true" />
            <h1 className="obs-panel__title" style={{ color: 'var(--text-primary)' }}>
              Tbilisi One · Simulator
            </h1>
          </span>
          <span className="obs-panel__title">
            {node.instrument.apertureMm} mm f/{(node.instrument.focalLengthMm / node.instrument.apertureMm).toFixed(0)} ·{' '}
            {fov.plateScaleArcsecPx.toFixed(2)}″/px
          </span>
        </div>
        <div className="obs-panel__body">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {node.instrument.optics} and a {node.instrument.camera} on a roof in {node.site}.
            Real field of view, real slew times, real refusals.
          </p>
        </div>
      </header>

      <div className="mt-6">
        <SessionConsole node={node} cloudCover={node.readiness.cloudCover} />
      </div>

      <details className="mt-6 max-w-2xl">
        <summary className="obs-label cursor-pointer">How the frame is built</summary>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          Public-domain NASA and ESA imagery supplies the content. Everything else is computed:
          the target is scaled to its true angular size at the current focal length, smeared by
          the seeing, shifted frame to frame by the same turbulence, lifted by the site&apos;s sky
          glow and buried in sensor noise. As the stack builds, the turbulence averages out and
          the image walks toward the aperture&apos;s diffraction limit, which it never beats. This
          is a simulation of what a 150 mm telescope shows, not a claim about what it captured.
        </p>
      </details>
    </PageContainer>
  );
}
