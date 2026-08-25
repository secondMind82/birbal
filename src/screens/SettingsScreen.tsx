import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import AppShell from '../components/AppShell';
import { Button, Card, ErrorText, Input } from '../components/ui';
import { updateProfile } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { usePrefsStore } from '../store/prefsStore';
import { colors, radii, spacing } from '../theme';

export default function SettingsScreen() {
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
              trackColor={{ false: '#D1D5DB', true: colors.accent }}
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
              trackColor={{ false: '#D1D5DB', true: colors.accent }}
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
              trackColor={{ false: '#D1D5DB', true: colors.accent }}
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
              trackColor={{ false: '#D1D5DB', true: colors.accent }}
              thumbColor="#fff"
            />
          </View>
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

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: 40, gap: spacing.md },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  name: { fontSize: 18, fontWeight: '700', color: colors.text },
  email: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  sectionTitle: { fontWeight: '700', fontSize: 15, marginBottom: spacing.md },
  emailLocked: {
    backgroundColor: '#F3F4F6',
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  emailLockedLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  emailLockedValue: { fontSize: 14, color: colors.text, fontWeight: '600', marginTop: 2 },
  emailLockedHint: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  saved: { color: colors.success, fontSize: 13, marginTop: spacing.xs },
  prefDesc: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  prefInfo: { flex: 1, marginRight: spacing.md },
  prefLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  prefTime: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  timeBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  timeBtnText: { fontSize: 12, fontWeight: '600', color: colors.accent },
});
