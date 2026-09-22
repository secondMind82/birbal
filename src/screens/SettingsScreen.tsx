import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import AppShell from '../components/AppShell';
import { Button, Card, ErrorText, Input } from '../components/ui';
import { updateProfile } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import { getLatestBackupInfo, restoreLatestBackup, uploadBackup } from '../services/backupService';
import { useAuthStore } from '../store/authStore';
import { usePrefsStore } from '../store/prefsStore';
import type { BackupMetadata } from '../models/types';
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

  const [lastBackup, setLastBackup] = useState<BackupMetadata | null>(null);
  const [backupWorking, setBackupWorking] = useState(false);
  const [restoreWorking, setRestoreWorking] = useState(false);

  useEffect(() => {
    let active = true;
    getLatestBackupInfo(user?.id)
      .then((info) => {
        if (active && info) setLastBackup(info);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleBackup = async () => {
    if (backupWorking) return;
    setBackupWorking(true);
    try {
      const meta = await uploadBackup(user?.id);
      setLastBackup(meta);
      Alert.alert('Backup completed successfully');
    } catch {
      Alert.alert('Backup failed. Please try again.');
    } finally {
      setBackupWorking(false);
    }
  };

  const confirmRestore = () => {
    if (restoreWorking || !lastBackup) return;
    Alert.alert('Restore your backup?', 'Your current local data may be replaced or merged with the backup.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', style: 'destructive', onPress: () => void runRestore() },
    ]);
  };

  const runRestore = async () => {
    if (restoreWorking) return;
    setRestoreWorking(true);
    try {
      await restoreLatestBackup(user?.id);
      Alert.alert('Restore completed successfully');
    } catch {
      Alert.alert('Restore failed. Please try again.');
    } finally {
      setRestoreWorking(false);
    }
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

        <Card>
          <Text style={styles.sectionTitle}>Data Backup &amp; Restore</Text>
          <Text style={styles.prefDesc}>
            Keep your data safe by creating a backup.
            {'\n'}Restore it anytime on this or a new device.
          </Text>

          <Button
            title={backupWorking ? 'Backing up...' : 'Backup Now'}
            onPress={() => void handleBackup()}
            disabled={backupWorking}
          />
          <Button
            title={restoreWorking ? 'Restoring...' : 'Restore'}
            onPress={confirmRestore}
            disabled={restoreWorking || !lastBackup}
            variant="outline"
          />

          <Text style={styles.backupState}>
            {lastBackup
              ? `Last backup: ${formatDateTime(lastBackup.createdAt)}`
              : 'No backup available'}
          </Text>
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
} as const);
