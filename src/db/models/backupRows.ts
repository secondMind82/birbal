// Row shape shared by the local snapshot engine, the backup service and the
// validator. Kept in its own module so pure logic (validation, v1 migration,
// canonical serialization) can be imported without pulling in expo-sqlite.
export type BackupRows = Record<string, Record<string, unknown>[]>;
