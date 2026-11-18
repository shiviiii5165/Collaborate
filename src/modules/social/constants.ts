/** Shared by the feed UI and tests. */

/** How often the browser sends batched impressions. Visibility rule and server dedupe are unchanged. */
export const IMPRESSION_FLUSH_INTERVAL_MS = 30_000;

/** A post counts as displayed once at least this share of it is on screen... */
export const IMPRESSION_VISIBLE_RATIO = 0.5;
/** ...for at least this long. */
export const IMPRESSION_DWELL_MS = 1_000;
