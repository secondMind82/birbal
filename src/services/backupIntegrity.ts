import * as Crypto from 'expo-crypto';

import { canonicalStringify, checksumsMatch, formatBytes } from './backupCanonical';

// Integrity helpers for Birbal backups (client half).
//
// The canonical serialization and digest comparison used to produce and check
// the digest live in backupCanonical.ts so they can be proven identical to the
// server's implementation without a device; this file adds the native digest.

export { canonicalStringify, checksumsMatch, formatBytes };

/** SHA-256 hex of an arbitrary string, via the native crypto module. */
export async function sha256Hex(input: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

/** Integrity fingerprint of a backup's `data` section. */
export async function checksumOfData(data: unknown): Promise<string> {
  return sha256Hex(canonicalStringify(data));
}
