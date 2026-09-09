/**
 * Stellar Observatory — domain types for the telescope-time network.
 *
 * Design: docs/observatory-network.md. These types describe nodes and sessions
 * as Stellar sees them; they are deliberately independent of any one node's
 * hardware API, which lives behind `ObservatoryAdapter`.
 */

/** Where a node is in its life, not whether it is online right now. */
export type NodeStatus =
  | 'commissioning' // built, not yet accepting bookings
  | 'active'        // reviewed and bookable
  | 'suspended'     // excluded from scheduling pending review
  | 'retired';

/** How a node joined the network. See docs/observatory-network.md §3. */
export type NodeTier =
  | 'first_party' // ours
  | 'kitted'      // Astroman customer running a Stellar Node Kit
  | 'byo';        // owner's existing ASCOM/Alpaca or INDI rig

/** Live operational state, refreshed from the node. */
export type ReadinessState =
  | 'online'   // connected, safe, ready to accept a mission
  | 'busy'     // a mission is running
  | 'weather'  // connected but held for cloud, wind or humidity
  | 'daylight' // Sun is up at the site
  | 'offline'; // no heartbeat

export type Instrument = {
  /** Optical tube: "Celestron NexStar 6SE". */
  optics: string;
  /** Millimetres. */
  apertureMm: number;
  focalLengthMm: number;
  mount: string;
  camera: string;
  /** Sensor width and height in millimetres — sets the field of view. */
  sensorWidthMm: number;
  sensorHeightMm: number;
  /** Pixel pitch in microns — sets the plate scale. */
  pixelSizeUm: number;
  /**
   * What this rig is actually good for. Keys, not words — the words live under
   * observatory.node.target* so they can be Georgian.
   */
  suitedTo: SuitedTo[];
};

export type SuitedTo = 'Moon' | 'Planets' | 'BrightDeepSky';

export type ObservatoryNode = {
  id: string;
  /** Public name. "Darkview Tbilisi", not the owner's name. */
  name: string;
  /** City / region shown to users; never a street address. */
  site: string;
  countryCode: string;
  lat: number;
  lon: number;
  /** IANA zone — sessions are quoted in the visitor's zone, scheduled in this one. */
  timezone: string;
  /** Bortle class at the site, 1 (pristine) to 9 (inner city). */
  bortle: number;
  tier: NodeTier;
  status: NodeStatus;
  instrument: Instrument;
  /** Per-session list price in GEL. Stars and card both settle against this. */
  priceGel: number;
  /** Minutes of telescope time one session buys. */
  sessionMinutes: number;
  /**
   * The recurring window, on the site's own wall clock, when the operator
   * accepts work. Omitted means the dark window is the only limit.
   */
  availability?: { fromHourLocal: number; toHourLocal: number };
  /**
   * The account that owns the instrument and is paid for it. Absent on a
   * first-party node: Stellar operates it, and nobody is owed a share.
   */
  operatorPrivyId?: string;
  /**
   * The node platform Stellar talks to, and the environment variable holding
   * its address. Absent means there is no hardware link and the simulator
   * speaks for this node.
   *
   * The URL is a name here rather than a value so no observatory's address is
   * committed to a public repository.
   */
  link?: { platform: 'darkview'; baseUrlEnv: string };
};

export type ReadinessDetail = {
  key: string;
  values?: Record<string, string | number>;
};

export type NodeReadiness = {
  nodeId: string;
  state: ReadinessState;
  /** Cloud cover percent at the site, 0-100, when known. */
  cloudCover: number | null;
  /** Local time at the site when this was measured. */
  checkedAt: string;
  /** Next moment the node could start a mission, ISO. Null when unknown. */
  nextWindowAt: string | null;
  /**
   * Why the node is in this state, as a message key and its values rather than
   * a sentence.
   *
   * An adapter runs on the server and has no locale; a reader does. Composing
   * English here and showing it to a Georgian customer was the whole problem,
   * and word order is not something a translator can fix after the fact.
   * Free text that is genuinely somebody else's — an operator's own note —
   * travels as a value under a key that renders it unchanged.
   */
  detail: ReadinessDetail | null;
};

/** A node plus its live state — what the browse surface renders. */
export type NodeWithReadiness = ObservatoryNode & { readiness: NodeReadiness };
