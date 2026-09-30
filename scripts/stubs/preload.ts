/**
 * Installs the native stubs as a side effect, before anything else is required.
 *
 * Any module under test that imports react-native or expo-modules-core must be
 * required AFTER this, so the resolver patch is already in place. In the
 * TypeScript output, import statements become requires in source order, so this
 * file has to stay the very first import of a test file that needs it.
 */
import { installExpoSqliteShim } from '../real-sqlite';

installExpoSqliteShim();
