import { sanitizeName } from './activityParser';
import type { Entity, Timeline } from '../models/types';

/**
 * Name-based entity resolution, shared by the Dashboard post composer and the SMS
 * save flow so both link to exactly the same person.
 *
 * This is the same matching the Dashboard has always used, lifted verbatim so
 * there is one definition of "is this the same person?" in the app. Matching is
 * case- and punctuation-insensitive because entity names are free text.
 */
export function findEntityByName(
  rawName: string,
  entities: Entity[],
  timelines: Timeline[] = [],
): Entity | undefined {
  const target = sanitizeName(rawName).toLowerCase();
  if (!target) return undefined;

  const candidates = entities.filter((e) => sanitizeName(e.name).toLowerCase().includes(target));
  if (candidates.length === 0) return undefined;

  // Prefer exact sanitized match
  const exact = candidates.find((e) => sanitizeName(e.name).toLowerCase() === target);
  if (exact) return exact;

  // If multiple candidates, pick the one with most linked timelines (most active)
  if (timelines && timelines.length > 0) {
    let best: Entity | undefined = undefined;
    let bestCount = -1;
    for (const c of candidates) {
      const count = timelines.filter((t) => (t.entities ?? []).some((l) => l.entityId === c.id)).length;
      if (count > bestCount) {
        best = c;
        bestCount = count;
      }
    }
    if (best) return best;
  }

  // Fallback: starts-with then contains
  const starts = candidates.find((e) => sanitizeName(e.name).toLowerCase().startsWith(target));
  if (starts) return starts;
  return candidates[0];
}
