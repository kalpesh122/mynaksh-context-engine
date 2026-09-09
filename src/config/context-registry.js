/**
 * Where each piece of context comes from, what it is called in a response, and
 * how to pull it out of the upstream payload. Everything else refers to context
 * by `id`; `label` is the human string used in `sourcesUsed`. Both live on one
 * row so they cannot drift.
 */

/** @typedef {'user'|'kundli'|'horoscope'|'panchang'} ServiceName */

export const CONTEXT_REGISTRY = Object.freeze({
  // ---- Kundli (birth chart) -------------------------------------------------
  lagna: {
    id: 'lagna', label: 'Lagna', service: 'kundli',
    extract: (k) => k?.lagna ?? null,
    render: (v) => `Lagna (ascendant): ${v}`,
  },
  moon_sign: {
    id: 'moon_sign', label: 'Moon Sign', service: 'kundli',
    extract: (k) => k?.moonSign ?? null,
    render: (v) => `Moon sign: ${v}`,
  },
  current_dasha: {
    id: 'current_dasha', label: 'Current Dasha', service: 'kundli',
    extract: (k) => k?.currentDasha ?? null,
    render: (v) => `Current dasha: ${v.mahadasha} mahadasha / ${v.antardasha} antardasha`,
  },
  house_6: {
    id: 'house_6', label: '6th House', service: 'kundli',
    extract: (k) => k?.houses?.['6'] ?? null,
    render: (v) => `6th house (health, obstacles): lord ${v.lord}, strength ${v.strength}`,
  },
  house_7: {
    id: 'house_7', label: '7th House', service: 'kundli',
    extract: (k) => k?.houses?.['7'] ?? null,
    render: (v) => `7th house (partnership): lord ${v.lord}, strength ${v.strength}`,
  },
  house_10: {
    id: 'house_10', label: '10th House', service: 'kundli',
    extract: (k) => k?.houses?.['10'] ?? null,
    render: (v) => `10th house (career, status): lord ${v.lord}, strength ${v.strength}`,
  },

  // ---- Horoscope (today's reading, per life area) ---------------------------
  career_horoscope: {
    id: 'career_horoscope', label: 'Career Horoscope', service: 'horoscope',
    extract: (h) => h?.career ?? null,
    render: (v) => `Career horoscope: ${v}`,
  },
  finance_horoscope: {
    id: 'finance_horoscope', label: 'Finance Horoscope', service: 'horoscope',
    extract: (h) => h?.finance ?? null,
    render: (v) => `Finance horoscope: ${v}`,
  },
  health_horoscope: {
    id: 'health_horoscope', label: 'Health Horoscope', service: 'horoscope',
    extract: (h) => h?.health ?? null,
    render: (v) => `Health horoscope: ${v}`,
  },
  relationship_horoscope: {
    id: 'relationship_horoscope', label: 'Relationship Horoscope', service: 'horoscope',
    extract: (h) => h?.relationship ?? null,
    render: (v) => `Relationship horoscope: ${v}`,
  },

  // ---- Panchang (shared daily almanac, not per-user) ------------------------
  panchang_today: {
    id: 'panchang_today', label: "Today's Panchang", service: 'panchang',
    extract: (p) => (p ? p : null),
    render: (v) =>
      `Today's panchang (${v.date}): tithi ${v.tithi}, nakshatra ${v.nakshatra}, yoga ${v.yoga}, karana ${v.karana}`,
  },
});

export const ALL_CONTEXT_IDS = Object.freeze(Object.keys(CONTEXT_REGISTRY));


export function labelFor(id) {
  const entry = CONTEXT_REGISTRY[id];
  if (!entry) throw new Error(`Unknown context id: ${id}`);
  return entry.label;
}

export function labelsFor(ids) {
  return ids.map(labelFor);
}

/** Called at boot: a typo in the intent config must fail fast, not drop context silently. */
export function assertKnownContextIds(ids, where) {
  for (const id of ids) {
    if (!Object.hasOwn(CONTEXT_REGISTRY, id)) {
      throw new Error(`Config error in ${where}: unknown context id "${id}"`);
    }
  }
}
