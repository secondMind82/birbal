import React from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Timeline } from '../models/types';
import { useNotificationStore } from '../store/notificationStore';
import { radii, spacing } from '../theme';
import { useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

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
  const theme = useAppTheme();
  const styles = useAppStyles((c) => notificationStyles(c));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.flex} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={styles.headerIconWrap}>
              <Text style={styles.headerIcon}>🔔</Text>
            </View>
            <Text style={styles.headerTitle}>Event Reminders</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={theme.accent} style={{ marginVertical: 32 }} />
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

const notificationStyles = (c: BirbalTheme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: c.surfaceElevated,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
      minHeight: 220,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: -6 },
      elevation: 16,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: c.border,
      marginTop: spacing.sm + 2,
      marginBottom: spacing.md,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
    headerIconWrap: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm,
    },
    headerIcon: { fontSize: 18 },
    headerTitle: { fontSize: 17, fontWeight: '800', color: c.text },
    empty: { textAlign: 'center', color: c.textSecondary, paddingVertical: 40 },
    reminderCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: c.surfaceVariant,
      borderRadius: radii.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    iconBox: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontWeight: '700', fontSize: 14, color: c.text },
    subtitle: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  });