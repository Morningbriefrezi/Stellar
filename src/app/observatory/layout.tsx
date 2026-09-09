import './observatory.css';

/**
 * The observatory runs on a darker ground than the rest of the app.
 *
 * `--canvas` is #0A1735, a blue bright enough to compete with a photograph.
 * These pages are photograph-led, so they drop to a deeper night sky and let
 * the picture be the brightest thing on the screen — the plan's §4.1, scoped to
 * this route rather than applied to every page in the app.
 */
export default function ObservatoryLayout({ children }: { children: React.ReactNode }) {
  return <div className="obs obs-ground">{children}</div>;
}
