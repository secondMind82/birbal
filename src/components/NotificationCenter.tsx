import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AppNotification, NotificationType } from '../models/types';
import { useNotificationStore } from '../store/notificationStore';
import { formatRelativeTime } from '../utils/activityParser';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

const TYPE_ICONS: Record<NotificationType, string> = {
  EVENT: '📅',
  BIRTHDAY: '🎂',
  REMINDER: '⏰',
  TIMELINE: '✨',
  SYSTEM: '💾',
};

function notificationIcon(n: AppNotification): string {
  return n.icon ?? TYPE_ICONS[n.type];
}

export default function NotificationCenter({
  visible,
  onClose,
  onOpenNotification,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenNotification: (n: AppNotification) => void;
}) {
  const notifications = useNotificationStore((s) => s.notifications);
  const unread = useNotificationStore((s) => s.notificationCount);
  const loading = useNotificationStore((s) => s.loading);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const theme = useAppTheme();
  const styles = useAppStyles((c) => notificationStyles(c));

  const openItem = (item: AppNotification) => {
    if (!item.read) void markRead(item.id);
    onOpenNotification(item);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.flex} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.highRow}>
            <View style={styles.headerRow}>
              <View style={styles.headerIconWrap}>
                <Text style={styles.headerIcon}>🔔</Text>
              </View>
              <Text style={styles.headerTitle}>Notifications</Text>
            </View>
            {unread > 0 && (
              <Pressable hitSlop={8} onPress={() => void markAllRead()}>
                <Text style={styles.markAll}>Mark all as read</Text>
              </Pressable>
            )}
          </View>

          {loading && notifications.length === 0 ? (
            <ActivityIndicator color={theme.accent} style={{ marginVertical: 32 }} />
          ) : notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyTitle}>No notifications</Text>
              <Text style={styles.emptySubtitle}>You're all caught up.</Text>
            </View>
          ) : (
            <FlatList
              style={styles.list}
              data={notifications}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => openItem(item)}
                  style={({ pressed }) => [
                    styles.notifCard,
                    !item.read && styles.notifCardUnread,
                    pressed && { opacity: 0.75 },
                  ]}>
                  <View style={styles.iconBox}>
                    <Text style={styles.iconText}>{notificationIcon(item)}</Text>
                  </View>
                  <View style={styles.cardBody}>
                    <Text
                      style={[styles.notifTitle, !item.read && styles.notifTitleUnread]}
                      numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.message ? (
                      <Text style={styles.notifMessage} numberOfLines={2}>
                        {item.message}
                      </Text>
                    ) : null}
                    <Text style={styles.notifTime}>
                      {formatRelativeTime(item.createdAt)}
                    </Text>
                  </View>
                  {!item.read && <View style={styles.unreadDot} />}
                </Pressable>
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
      maxHeight: '72%',
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
    highRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
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
    markAll: {
      fontSize: 12,
      fontWeight: '700',
      color: c.accent,
      letterSpacing: 0.2,
    },
    list: { flexShrink: 1 },
    notifCard: {
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
    notifCardUnread: {
      backgroundColor: c.accentSoft,
      borderColor: c.primaryLight,
    },
    iconBox: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderFaint,
    },
    iconText: { fontSize: 17 },
    cardBody: { flex: 1 },
    notifTitle: { fontWeight: '700', fontSize: 14, color: c.text },
    notifTitleUnread: { fontWeight: '800' },
    notifMessage: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 },
    notifTime: { fontSize: 11, color: c.textSecondary, marginTop: 4, letterSpacing: 0.2 },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.danger,
      marginLeft: spacing.xs,
    },
    emptyState: { alignItems: 'center', paddingVertical: 44 },
    emptyIcon: { fontSize: 40, marginBottom: spacing.md },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: c.text,
      letterSpacing: -0.2,
    },
    emptySubtitle: { fontSize: 13, color: c.textSecondary, marginTop: 4 },
  });