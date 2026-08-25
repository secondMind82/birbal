import React from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Timeline } from '../models/types';
import { useNotificationStore } from '../store/notificationStore';
import { colors, radii, spacing } from '../theme';

export function cleanEventTitle(title: string): string {
  return title.replace(/@/g, '').trim() || 'Event Details';
}

function formatStartTime(eventDate: string): string {
  const d = new Date(eventDate);
  if (isNaN(d.getTime())) return 'Upcoming';
  return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
}

export default function NotificationCenter({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const reminders = useNotificationStore((s) => s.reminders);
  const loading = useNotificationStore((s) => s.loading);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.flex} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.headerIcon}>🔔</Text>
            <Text style={styles.headerTitle}>Event Reminders</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 32 }} />
          ) : reminders.length === 0 ? (
            <Text style={styles.empty}>No upcoming events for today.</Text>
          ) : (
            <FlatList
              style={{ maxHeight: 400 }}
              data={reminders}
              keyExtractor={(t: Timeline) => t.id}
              renderItem={({ item }) => (
                <View style={styles.reminderCard}>
                  <View style={styles.iconBox}>
                    <Text style={{ fontSize: 18 }}>📅</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>
                      {cleanEventTitle(item.title)}
                    </Text>
                    <Text style={styles.subtitle}>Starts at {formatStartTime(item.eventDate)}</Text>
                  </View>
                </View>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    minHeight: 220,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.sm + 2,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  headerIcon: { fontSize: 20, marginRight: spacing.sm },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  empty: { textAlign: 'center', color: colors.textSecondary, paddingVertical: 40 },
  reminderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontWeight: '700', fontSize: 14, color: colors.text },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
