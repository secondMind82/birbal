import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import type { Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as timelinesService from '../services/timelinesService';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';
import type { DetailRow } from '../utils/activityParser';
import { activityEmoji, parseActivity } from '../utils/activityParser';

type Props = NativeStackScreenProps<RootStackParamList, 'PreviewTimeline'>;
type IconName = ComponentProps<typeof Ionicons>['name'];

const DETAIL_ICONS: Record<string, IconName> = {
  Date: 'calendar-outline',
  Time: 'time-outline',
  Day: 'time-outline',
  'Hosted by': 'person-outline',
  Location: 'location-outline',
  Contribution: 'cash-outline',
  Amount: 'cash-outline',
  Wishing: 'gift-outline',
};

const ESSENTIAL_DETAIL_LABELS = new Set(['Date', 'Time', 'Location', 'Day']);

function detailIcon(label: string): IconName {
  return DETAIL_ICONS[label] ?? 'information-circle-outline';
}

function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
}

function entryTime(t: Timeline): string {
  const d = new Date(t.eventDate);
  if (!isNaN(d.getTime())) {
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
    if (hasTime) return formatTime(t.eventDate);
  }
  if (t.createdAt) {
    const c = formatTime(t.createdAt);
    if (c) return c;
  }
  return formatTime(t.eventDate);
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const entryDay = new Date(d);
  entryDay.setHours(0, 0, 0, 0);
  if (entryDay.getTime() === today.getTime()) return 'Today';
  if (entryDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' });
}

function compareTimelinesDesc(a: Timeline, b: Timeline): number {
  const byDate = (b.eventDate || '').localeCompare(a.eventDate || '');
  if (byDate !== 0) return byDate;
  return (b.createdAt || '').localeCompare(a.createdAt || '');
}

export default function PreviewTimelineScreen({ route, navigation }: Props) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const { timeline } = route.params;
  const userId = useAuthStore((s) => s.user?.id);

  const [allTimelines, setAllTimelines] = useState<Timeline[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(true);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!userId) return () => { active = false; };
      setLoadingRelated(true);
      timelinesService.getTimelines(userId)
        .then((list) => active && setAllTimelines(list))
        .catch((e) => active && setRelatedError(getErrorMessage(e)))
        .finally(() => active && setLoadingRelated(false));
      return () => {
        active = false;
      };
    }, [userId]),
  );

  const description = timeline.description ?? '';
  const person =
    timeline.entities?.find((l) => l.entity.type === 'PERSON')?.entity.name ??
    description.trim().split(/\s+/)[0] ??
    '';

  const parsed = parseActivity(description, person);
  const displayTitle = parsed.matched && parsed.title ? parsed.title : timeline.title;

  const confirmDelete = () => {
    Alert.alert('Delete Event', `"${timeline.title}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          timelinesService.deleteTimeline(userId, timeline.id)
            .then(() => navigation.popToTop())
            .catch((e) => Alert.alert('Error', getErrorMessage(e)));
        },
      },
    ]);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: displayTitle,
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Edit Event"
            hitSlop={8}
            onPress={() => navigation.navigate('EditTimeline', { timeline })}>
            <Ionicons name="pencil-outline" size={20} color="#fff" />
          </Pressable>
          <Pressable accessibilityLabel="Delete Event" hitSlop={8} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={20} color="#fff" />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, timeline, displayTitle, confirmDelete]);

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
  const essentialDetails = details.filter((row) => ESSENTIAL_DETAIL_LABELS.has(row.label));
  const extraDetails = details.filter((row) => !ESSENTIAL_DETAIL_LABELS.has(row.label));

  const showMessage =
    parsed.matched && parsed.message && parsed.message.trim().length > 0;

  const createdLabel = formatDateTime(timeline.createdAt ?? timeline.eventDate);

  const linkedEntityIds = useMemo(
    () => new Set((timeline.entities ?? []).map((l) => l.entityId)),
    [timeline.entities],
  );

  const relatedEvents = useMemo(
    () =>
      allTimelines
        .filter((t) => t.id !== timeline.id)
        .filter((t) => (t.entities ?? []).some((l) => linkedEntityIds.has(l.entityId)))
        .sort(compareTimelinesDesc),
    [allTimelines, timeline.id, linkedEntityIds],
  );

  const dayGroups = useMemo(
    () => {
      const map = new Map<string, Timeline[]>();
      for (const t of relatedEvents) {
        const label = dayLabel(t.eventDate) || 'Other';
        const arr = map.get(label) ?? [];
        arr.push(t);
        map.set(label, arr);
      }
      return [...map.entries()]
        .map(([label, entries]) => ({
          label,
          entries: [...entries].sort(compareTimelinesDesc),
        }))
        .sort((a, b) => compareTimelinesDesc(a.entries[0], b.entries[0]));
    },
    [relatedEvents],
  );

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <Pressable
        style={styles.detailsCard}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse event details' : 'Expand event details'}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {heroEmoji}  {displayTitle}
          </Text>
        </View>
        {person ? (
          <View style={styles.personRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{person[0].toUpperCase()}</Text>
            </View>
            <Text style={styles.personLabel}>{person}</Text>
          </View>
        ) : null}
        {essentialDetails.length > 0 ? (
          <View style={styles.detailsList}>
            {essentialDetails.map((row, i) => (
              <View key={i} style={[styles.detailRow, i > 0 && styles.detailRowBorder]}>
                <Ionicons name={detailIcon(row.label)} size={14} color={t.accent} />
                <Text style={styles.detailValue} numberOfLines={1}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {expanded ? (
          <View style={styles.expandedSection}>
            {description.trim().length > 0 ? (
              <Text style={styles.description}>{description.trim()}</Text>
            ) : null}
            {extraDetails.length > 0 ? (
              <View style={styles.detailsList}>
                {extraDetails.map((row, i) => (
                  <View key={i} style={[styles.detailRow, i > 0 && styles.detailRowBorder]}>
                    <Ionicons name={detailIcon(row.label)} size={15} color={t.accent} />
                    <Text style={styles.detailValue} numberOfLines={1}>
                      {row.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {showMessage ? (
              <View style={styles.messageCard}>
                <Text style={styles.messageText}>{parsed.message}</Text>
              </View>
            ) : null}
            <View style={styles.metaFooter}>
              <View style={styles.metaRow}>
                <Ionicons name="calendar-outline" size={15} color={t.textSecondary} />
                <Text style={styles.metaText}>
                  {timeline.showOnCalendar ? 'Shown on calendar' : 'Hidden from calendar'}
                </Text>
              </View>
              {createdLabel ? (
                <View style={styles.metaRow}>
                  <Ionicons name="time-outline" size={15} color={t.textSecondary} />
                  <Text style={styles.metaText}>Created {createdLabel}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
        <View style={styles.chevron}>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={t.textSecondary}
          />
        </View>
      </Pressable>

      <View style={styles.relatedSection}>
        <Text style={styles.relatedTitle}>Related Timeline</Text>
        <Text style={styles.relatedSubtitle}>Timelines for people in this event</Text>

        {loadingRelated ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : relatedError ? (
          <Text style={styles.relatedEmpty}>{relatedError}</Text>
        ) : dayGroups.length === 0 ? (
          <Text style={styles.relatedEmpty}>
            No timeline entries for the people in this event yet.
          </Text>
        ) : (
          dayGroups.map((group) => (
            <View key={group.label} style={styles.dayGroup}>
              <Text style={styles.dayLabel}>{group.label}</Text>
              {group.entries.map((t) => {
                const tParsed = parseActivity(t.description ?? '');
                const title =
                  tParsed.matched && tParsed.title
                    ? tParsed.title
                    : (t.description ?? '').split('\n')[0] || t.title;
                const people = (t.entities ?? [])
                  .filter((l) => linkedEntityIds.has(l.entityId))
                  .map((l) => l.entity.name);
                const indicator = people.join(', ') || (t.entities?.[0]?.entity.name ?? '');
                const initial = indicator ? indicator[0].toUpperCase() : '?';
                return (
                  <Pressable
                    key={t.id}
                    style={({ pressed }) => [styles.tlCard, pressed && { opacity: 0.7 }]}
                    onPress={() => navigation.navigate('PreviewTimeline', { timeline: t })}>
                    <Text style={styles.tlTitle} numberOfLines={2}>{title}</Text>
                    {t.description ? (
                      <Text style={styles.tlDesc} numberOfLines={2}>{t.description}</Text>
                    ) : null}
                    <View style={styles.tlFooter}>
                      {indicator ? (
                        <View style={styles.tlPersonRow}>
                          <View style={styles.tlAvatar}>
                            <Text style={styles.tlAvatarText}>{initial}</Text>
                          </View>
                          <Text style={styles.tlPersonText}>Person: {indicator}</Text>
                        </View>
                      ) : (
                        <View />
                      )}
                      <Text style={styles.tlTimestamp}>{entryTime(t)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  container: { padding: spacing.lg, paddingBottom: 40, gap: spacing.md },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  detailsCard: {
    backgroundColor: t.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md + 2,
    paddingBottom: spacing.lg + 6,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: t.text,
    lineHeight: 21,
  },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: t.onAccent, fontSize: 11, fontWeight: '800' },
  personLabel: { fontSize: 13, fontWeight: '700', color: t.text },
  description: {
    fontSize: 14,
    color: t.textSecondary,
    lineHeight: 20,
  },
  expandedSection: { marginTop: spacing.md, gap: spacing.md, paddingRight: spacing.md },
  chevron: { position: 'absolute', right: spacing.md, bottom: spacing.md },
  detailsList: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: t.borderFaint, paddingTop: spacing.xs },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 5,
  },
  detailRowBorder: {
    borderTopWidth: 1,
    borderTopColor: t.borderFaint,
  },
  detailValue: { flex: 1, fontSize: 14, fontWeight: '600', color: t.text },
  messageCard: {
    backgroundColor: t.surfaceVariant,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: t.accent,
  },
  messageText: { fontSize: 15, lineHeight: 24, color: t.text },
  metaFooter: {
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
    gap: spacing.xs + 2,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaText: { fontSize: 12, color: t.textSecondary },
  relatedSection: { marginTop: spacing.sm },
  relatedTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: t.text,
    marginBottom: 2,
  },
  relatedSubtitle: {
    fontSize: 13,
    color: t.textSecondary,
    marginBottom: spacing.md,
  },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  relatedEmpty: {
    color: t.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    lineHeight: 20,
  },
  dayGroup: { marginBottom: spacing.md },
  dayLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: t.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
  },
  tlCard: {
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tlTitle: { fontSize: 15, fontWeight: '800', color: t.text },
  tlDesc: { fontSize: 13, color: t.textSecondary, marginTop: 4, lineHeight: 18 },
  tlFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  tlPersonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tlTimestamp: { fontSize: 11, color: t.border },
  tlAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tlAvatarText: { color: t.accent, fontSize: 10, fontWeight: '800' },
  tlPersonText: { fontSize: 12, fontWeight: '600', color: t.textSecondary },
}) as const;