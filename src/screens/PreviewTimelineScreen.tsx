import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Chip } from '../components/ui';
import { deleteTimeline } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { colors, radii, spacing } from '../theme';
import type { DetailRow } from '../utils/activityParser';
import { activityEmoji, formatRelativeTime, parseActivity } from '../utils/activityParser';

type Props = NativeStackScreenProps<RootStackParamList, 'PreviewTimeline'>;

export default function PreviewTimelineScreen({ route, navigation }: Props) {
  const { timeline } = route.params;

  const confirmDelete = () => {
    Alert.alert('Delete Event', `"${timeline.title}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteTimeline(timeline.id)
            .then(() => navigation.popToTop())
            .catch((e) => Alert.alert('Error', getErrorMessage(e)));
        },
      },
    ]);
  };

  const description = timeline.description ?? '';
  const person =
    timeline.entities?.find((l) => l.entity.type === 'PERSON')?.entity.name ??
    description.trim().split(/\s+/)[0] ??
    '';

  const parsed = parseActivity(description, person);
  const displayTitle = parsed.matched && parsed.title ? parsed.title : timeline.title;
  const heroEmoji = activityEmoji(displayTitle);

  const date = new Date(timeline.eventDate);
  const validDate = !isNaN(date.getTime());
  const dateRow: DetailRow | null = validDate
    ? {
        emoji: '📅',
        label: 'Date',
        value: date.toLocaleDateString('en', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      }
    : null;
  const details = [dateRow, ...parsed.details].filter(
    (row): row is DetailRow => !!row && row.value.trim().length > 0,
  );

  const message =
    parsed.message && parsed.message.trim().length > 0
      ? parsed.message
      : description.trim().length > 0 && !parsed.matched
        ? description
        : '';

  const createdLabel = formatRelativeTime(timeline.createdAt ?? timeline.eventDate);
  const initial = person ? person[0].toUpperCase() : '?';

  const otherEntities =
    timeline.entities?.filter((l) => l.entity.type !== 'PERSON') ?? [];

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>{heroEmoji}</Text>
        </View>
        <Text style={styles.heroTitle}>{displayTitle}</Text>
        {person ? (
          <View style={styles.heroPersonRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <Text style={styles.heroPerson}>{person}</Text>
          </View>
        ) : null}
        <Text style={styles.heroMeta}>{createdLabel}</Text>
      </View>

      {description.trim().length > 0 && (
        <View style={styles.card}>
          <Text style={styles.originalInputText}>&ldquo;{description.trim()}&rdquo;</Text>
        </View>
      )}

      {details.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Details</Text>
          {details.map((row, i) => (
            <View key={i} style={styles.detailRow}>
              <Text style={styles.detailEmoji}>{row.emoji}</Text>
              <View style={styles.detailContent}>
                <Text style={styles.detailLabel}>{row.label}</Text>
                <Text style={styles.detailValue}>{row.value}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {message ? (
        <View style={styles.card}>
          <Text style={styles.messageText}>{message}</Text>
        </View>
      ) : null}

      {otherEntities.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Related</Text>
          <View style={styles.chipsRow}>
            {otherEntities.map((l) => (
              <Chip key={l.entityId} text={`@${l.entity.name}`} />
            ))}
          </View>
        </View>
      )}

      <View style={styles.footerMeta}>
        <Text style={styles.footerText}>Created {createdLabel}</Text>
        <View style={styles.footerDivider} />
        <Text style={styles.footerText}>
          {timeline.showOnCalendar ? '🗓️ Shown on calendar' : 'Hidden from calendar'}
        </Text>
      </View>

      <Button title="Edit" onPress={() => navigation.navigate('EditTimeline', { timeline })} />
      <Button title="Delete" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: 40, gap: spacing.md },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    padding: spacing.xl,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  heroBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroBadgeText: { fontSize: 34 },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    lineHeight: 28,
  },
  heroPersonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  heroPerson: { fontSize: 15, fontWeight: '700', color: colors.text },
  heroMeta: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: '#F9FAFB',
    borderRadius: radii.sm,
  },
  detailEmoji: { fontSize: 15, marginRight: spacing.sm, marginTop: 1, width: 22, textAlign: 'center' },
  detailContent: { flex: 1 },
  detailLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 1 },
  originalInputText: { fontSize: 15, lineHeight: 24, color: colors.text, fontStyle: 'italic' },
  messageText: { fontSize: 15, lineHeight: 24, color: colors.text },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footerMeta: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  footerText: { fontSize: 12, color: colors.textSecondary },
  footerDivider: {
    width: 24,
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
});