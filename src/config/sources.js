/**
 * Where context comes from.
 *
 * The last thing in this system that used to be code. Intents, the context
 * registry, response shaping and classifier weights were all data; the upstream
 * source list was a hardcoded array inside UpstreamClient, so "add a context
 * source" meant editing the fetch loop. That hole sat in the middle of the
 * extensibility story.
 *
 * A source declares two structural things:
 *   path(userId)     - where to fetch it
 *   cacheKey(userId) - what identity to cache it under
 *
 * `cacheKey` is the interesting one. Most sources are per-user. Panchang is the
 * same for every user on a given day, so it returns a constant — one fetch
 * serves the whole userbase. Expressing that as a function rather than a flag
 * means a future source can key on anything (birth city, subscription tier)
 * without a new concept.
 *
 * TTLs deliberately live in app.config.js instead: how long to trust a value is
 * operational tuning that ops changes per environment, while path and identity
 * are structural facts about the service.
 */

const perUser = (name) => ({
  path: (userId) => `/${name}/${encodeURIComponent(userId)}`,
  cacheKey: (userId) => userId,
});

export const UPSTREAM_SOURCES = Object.freeze({
  user: perUser('users'),
  kundli: perUser('kundli'),
  horoscope: perUser('horoscope'),

  /** Identical for every user today, so one shared key serves everyone. */
  panchang: { path: () => '/panchang', cacheKey: () => 'global' },
});
