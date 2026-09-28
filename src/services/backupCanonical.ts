// Canonical JSON serialization for Birbal backups.
//
// This module is intentionally free of any native/Expo dependency: the SAME
// algorithm is used by the client (expo-crypto for the digest) and by the
// server (node:crypto), and it is verified byte-for-byte against the server
// implementation by scripts/verify-backup.ts. Changing the key ordering here
// would invalidate every stored backup's checksum, so treat it as frozen.

/**
 * Deterministic JSON: object keys sorted recursively so the same logical data
 * always serializes identically regardless of insertion order. Mirrors
 * canonicalStringify() in secondbrain-api/src/backup/backup-format.ts.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`)
    .join(',')}}`;
}

/**
 * Compares two hex digests without an early exit on the first differing
 * character, so the comparison time does not leak where a mismatch was.
 */
export function checksumsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Human-readable byte size for the Settings screen. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
