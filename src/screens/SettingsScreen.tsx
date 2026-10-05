import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import AppShell from '../components/AppShell';
import SmsPermissionCard from '../components/SmsPermissionCard';
import { Button, Card, ErrorText, Input } from '../components/ui';
import { updateProfile } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import { formatBytes } from '../services/backupIntegrity';
import {
  getLatestBackupInfo,
  hasLocalSnapshot,
  restoreLatestBackup,
  rollbackRestore,
  uploadBackup,
  type BackupProgress,
} from '../services/backupService';
import { useAuthStore } from '../store/authStore';
import { usePrefsStore } from '../store/prefsStore';
import type { BackupInfo } from '../models/types';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

export default function SettingsScreen() {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const { prefs, setMorning, setEvening, setEmailOnEvent, setPushEnabled } = usePrefsStore();

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [showMorningPicker, setShowMorningPicker] = useState(false);
  const [showEveningPicker, setShowEveningPicker] = useState(false);

  // ─── Backup & Restore ─────────────────────────────────────────────────────
  // `lastBackup === null` means "this account has no cloud backup", which is a
  // valid state that must stay visible and the Restore button must remain
  // tappable (the server is the source of truth for that, not this screen).
  // `backupIssue` carries a real connectivity/service failure so a network
  // error is never rendered as "no backup".
  const [lastBackup, setLastBackup] = useState<BackupInfo | null>(null);
  const [backupIssue, setBackupIssue] = useState<string | null>(null);
  const [backupPhase, setBackupPhase] = useState<BackupProgress | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<string | null>(null);
  const [canRollback, setCanRollback] = useState(false);

  const backupWorking = backupPhase !== null && backupPhase.phase !== 'done';
  // A restore spends real time validating and preparing the payload before any
  // row is written, so those phases count as restore work too. Otherwise the
  // screen would show the backup button spinning "Backing up…" mid-restore.
  const restoreWorking =
    backupPhase?.phase === 'validating' ||
    backupPhase?.phase === 'preparing' ||
    backupPhase?.phase === 'downloading' ||
    backupPhase?.phase === 'restoring';

  useEffect(() => {
    let active = true;
    setBackupIssue(null);
    setBackupError(null);
    getLatestBackupInfo(user?.id)
      .then((info) => {
        if (!active) return;
        setLastBackup(info);
        setBackupIssue(null);
      })
      .catch((e: Error) => {
        if (active) setBackupIssue(e.message);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  // The safety snapshot is written to the local database, so it survives an app
  // restart. Query it on mount rather than only setting the flag after a
  // restore in this screen session — otherwise "Undo last restore" would
  // silently disappear for a user who closed the app before deciding.
  useEffect(() => {
    let active = true;
    hasLocalSnapshot(user?.id)
      .then((exists) => {
        if (active) setCanRollback(exists);
      })
      .catch(() => {
        // A missing local snapshot is not an error; the button simply stays hidden.
        if (active) setCanRollback(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleBackup = async () => {
    if (backupWorking) return;
    setBackupError(null);
    setRestoreSummary(null);
    setBackupPhase({ phase: 'preparing', message: 'Preparing…' });
    try {
      const { metadata, totalRows } = await uploadBackup(user?.id, setBackupPhase);
      setLastBackup((prev) => ({ ...(prev ?? ({} as BackupInfo)), ...metadata }));
      setBackupIssue(null);
      setRestoreSummary(
        `Backed up ${totalRows} record${totalRows === 1 ? '' : 's'} to your account.`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Backup failed. Please try again.';
      setBackupError(message);
      Alert.alert('Backup failed', message);
    } finally {
      setBackupPhase(null);
    }
  };

  const confirmRestore = () => {
    if (backupWorking) return;
    Alert.alert(
      'Restore your backup?',
      'Your current data on this device will be replaced with the backup. A local safety copy is kept so you can undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', style: 'destructive', onPress: () => void runRestore() },
      ],
    );
  };

  const runRestore = async () => {
    if (backupWorking) return;
    setBackupError(null);
    setRestoreSummary(null);
    setBackupPhase({ phase: 'downloading', message: 'Downloading…' });
    try {
      const summary = await restoreLatestBackup(user?.id, setBackupPhase);
      setRestoreSummary(`Restored ${summary.label}.`);
      setCanRollback(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Restore failed. Please try again.';
      setBackupError(message);
      Alert.alert('Restore failed', message);
    } finally {
      setBackupPhase(null);
    }
  };

  const runRollback = () => {
    Alert.alert('Undo the last restore?', 'Your data on this device will go back to what it was before the restore.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Undo',
        style: 'destructive',
        onPress: async () => {
          setBackupPhase({ phase: 'restoring', message: 'Rolling back…' });
          try {
            const summary = await rollbackRestore(user?.id, setBackupPhase);
            setRestoreSummary(`Rolled back to your previous data (${summary.label}).`);
            setCanRollback(false);
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Undo failed.';
            setBackupError(message);
            Alert.alert('Undo failed', message);
          } finally {
            setBackupPhase(null);
          }
        },
      },
    ]);
  };

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const res = await updateProfile({
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        bio: bio.trim() || null,
        email: user?.email ?? null,
        username: username.trim() || null,
      });
      await setUser(res.user);
      setSaved(true);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const confirmLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  const formatTime = (h: number, m: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 || 12;
    return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  return (
    <AppShell title="Settings">
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.fullName ?? 'B').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user?.fullName}</Text>
              <Text style={styles.email}>{user?.email}</Text>
            </View>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Edit Profile</Text>
          <Input label="Full Name" value={fullName} onChangeText={setFullName} />
          <Input
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <Input label="Phone" value={phone} onChangeText={setPhone} />
          <Input label="Bio" value={bio} onChangeText={setBio} multiline />

          <View style={styles.emailLocked}>
            <Text style={styles.emailLockedLabel}>Email</Text>
            <Text style={styles.emailLockedValue}>{user?.email ?? 'Not set'}</Text>
            <Text style={styles.emailLockedHint}>Email cannot be changed here</Text>
          </View>

          <ErrorText error={error} />
          {saved ? <Text style={styles.saved}>✓ Profile updated</Text> : null}

          <Button
            title="Save Changes"
            onPress={() => void handleSave()}
            loading={loading}
            disabled={!fullName.trim()}
            style={{ marginTop: spacing.md }}
          />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Notification Preferences</Text>
          <Text style={styles.prefDesc}>
            Receive 24h-before reminders for upcoming timeline events.
          </Text>

          <View style={styles.prefRow}>
            <View style={styles.prefInfo}>
              <Text style={styles.prefLabel}>Morning reminders</Text>
              <Text style={styles.prefTime}>
                {formatTime(prefs.morningHour, prefs.morningMinute)}
              </Text>
            </View>
            <Switch
              value={prefs.morningEnabled}
              onValueChange={setMorning}
              trackColor={{ false: t.border, true: t.accent }}
              thumbColor="#fff"
            />
          </View>
          {prefs.morningEnabled && (
            <Pressable
              style={styles.timeBtn}
              onPress={() => setShowMorningPicker(true)}>
              <Text style={styles.timeBtnText}>Change time</Text>
            </Pressable>
          )}

          <View style={styles.prefRow}>
            <View style={styles.prefInfo}>
              <Text style={styles.prefLabel}>Evening reminders</Text>
              <Text style={styles.prefTime}>
                {formatTime(prefs.eveningHour, prefs.eveningMinute)}
              </Text>
            </View>
            <Switch
              value={prefs.eveningEnabled}
              onValueChange={setEvening}
              trackColor={{ false: t.border, true: t.accent }}
              thumbColor="#fff"
            />
          </View>
          {prefs.eveningEnabled && (
            <Pressable
              style={styles.timeBtn}
              onPress={() => setShowEveningPicker(true)}>
              <Text style={styles.timeBtnText}>Change time</Text>
            </Pressable>
          )}

          <View style={styles.prefRow}>
            <View style={styles.prefInfo}>
              <Text style={styles.prefLabel}>Email notifications</Text>
            </View>
            <Switch
              value={prefs.emailOnEvent}
              onValueChange={setEmailOnEvent}
              trackColor={{ false: t.border, true: t.accent }}
              thumbColor="#fff"
            />
          </View>

          <View style={styles.prefRow}>
            <View style={styles.prefInfo}>
              <Text style={styles.prefLabel}>Push notifications</Text>
            </View>
            <Switch
              value={prefs.pushEnabled}
              onValueChange={setPushEnabled}
              trackColor={{ false: t.border, true: t.accent }}
              thumbColor="#fff"
            />
          </View>
        </Card>

        <SmsPermissionCard />

        <Card>
          <Text style={styles.sectionTitle}>Data Backup &amp; Restore</Text>
          <Text style={styles.prefDesc}>
            Back up everything on this device to your Birbal account, then restore it on any other device
            signed in to the same account.
            {'\n'}Notes, diary entries, people, timelines, events, expenses, credits, debits, SMS messages, reminders and read state are
            included. Your password and session are never part of a backup.
          </Text>

          <View style={styles.backupButtons}>
            <View style={styles.backupButton}>
              <Button
                title={backupWorking && !restoreWorking ? 'Backing up…' : 'Back up now'}
                onPress={() => void handleBackup()}
                disabled={backupWorking}
                loading={backupWorking && !restoreWorking}
              />
            </View>
            <View style={styles.backupButton}>
              <Button
                title={restoreWorking ? 'Restoring…' : 'Restore'}
                onPress={confirmRestore}
                disabled={backupWorking}
                variant="outline"
              />
            </View>
          </View>

          {canRollback && (
            <Button
              title="Undo last restore"
              onPress={runRollback}
              disabled={backupWorking}
              variant="outline"
            />
          )}

          {backupPhase && backupWorking && <Text style={styles.backupProgress}>{backupPhase.message}</Text>}

          {lastBackup && (
            <>
              <Text style={styles.backupState}>
                Last backup: {formatDateTime(lastBackup.createdAt)}
                {`\n`}
                {`${lastBackup.backupVersion === 2 ? 'Format v2' : `Format v${lastBackup.backupVersion}`} · ${formatBytes(lastBackup.sizeBytes)}${
                  lastBackup.appVersion ? ` · app ${lastBackup.appVersion}` : ''
                }`}
                {lastBackup.recordCounts && Object.keys(lastBackup.recordCounts).length > 0
                  ? `\n${Object.entries(lastBackup.recordCounts)
                      .filter(([key]) => !['total', 'contacts', 'timelineEntityLinks', 'notifications', 'smsMessages', 'sms'].includes(key))
                      .map(([key, count]) => `${count} ${key.replace(/_/g, ' ')}`)
                      .join(' · ')}`
                  : ''}
              </Text>
              {lastBackup.checksum && (
                <Text style={styles.backupState}>Integrity verified · checksum {lastBackup.checksum.slice(0, 12)}…</Text>
              )}
            </>
          )}

          {!lastBackup && !backupIssue && <Text style={styles.backupState}>No backup found for this account.</Text>}
          {backupIssue && <ErrorText error={backupIssue} />}
          {backupError && <ErrorText error={backupError} />}
          {restoreSummary && <Text style={styles.backupSuccess}>{restoreSummary}</Text>}
        </Card>

        <Button title="Logout" variant="danger" onPress={confirmLogout} />

        {showMorningPicker && (
          <DateTimePicker
            value={new Date(2000, 0, 1, prefs.morningHour, prefs.morningMinute)}
            mode="time"
            is24Hour={false}
            onChange={(_, date) => {
              setShowMorningPicker(false);
              if (date) {
                usePrefsStore.getState().setMorningTime(date.getHours(), date.getMinutes());
              }
            }}
          />
        )}
        {showEveningPicker && (
          <DateTimePicker
            value={new Date(2000, 0, 1, prefs.eveningHour, prefs.eveningMinute)}
            mode="time"
            is24Hour={false}
            onChange={(_, date) => {
              setShowEveningPicker(false);
              if (date) {
                usePrefsStore.getState().setEveningTime(date.getHours(), date.getMinutes());
              }
            }}
          />
        )}
      </ScrollView>
    </AppShell>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  container: { padding: spacing.lg, paddingBottom: 40, gap: spacing.md },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: t.onAccent, fontSize: 28, fontWeight: '800' },
  name: { fontSize: 18, fontWeight: '700', color: t.text },
  email: { fontSize: 13, color: t.textSecondary, marginTop: 2 },
  sectionTitle: { color: t.text, fontWeight: '700', fontSize: 15, marginBottom: spacing.md },
  emailLocked: {
    backgroundColor: t.surfaceVariant,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  emailLockedLabel: { fontSize: 12, fontWeight: '600', color: t.textSecondary },
  emailLockedValue: { fontSize: 14, color: t.text, fontWeight: '600', marginTop: 2 },
  emailLockedHint: { fontSize: 11, color: t.textSecondary, marginTop: 4 },
  saved: { color: t.success, fontSize: 13, marginTop: spacing.xs },
  prefDesc: { fontSize: 13, color: t.textSecondary, marginBottom: spacing.md },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border,
  },
  prefInfo: { flex: 1, marginRight: spacing.md },
  prefLabel: { fontSize: 14, fontWeight: '600', color: t.text },
  prefTime: { fontSize: 12, color: t.textSecondary, marginTop: 2 },
  timeBtn: {
    alignSelf: 'flex-start',
    backgroundColor: t.accentSoft,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  timeBtnText: { fontSize: 12, fontWeight: '600', color: t.accent },
  backupState: { fontSize: 13, color: t.textSecondary, marginTop: spacing.sm + 2 },
  backupProgress: { fontSize: 13, color: t.accent, marginTop: spacing.sm + 2 },
  backupSuccess: { fontSize: 13, color: t.success, marginTop: spacing.sm + 2 },
  backupButtons: { flexDirection: 'row', gap: spacing.sm },
  backupButton: { flex: 1 },
} as const);
