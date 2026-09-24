import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import type { Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as entitiesService from '../services/entitiesService';
import * as timelinesService from '../services/timelinesService';
import * as expensesService from '../services/expensesService';
import { formatPaise, isReceivablePending } from '../utils/money';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PreviewEntity'>;

function formatDate(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
}

export default function PreviewEntityScreen({ route, navigation }: Props) {
  const theme = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const { entity } = route.params;
  const userId = useAuthStore((s) => s.user?.id);

  const confirmDelete = () => {
    Alert.alert('Delete Entity', `"${entity.name}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          entitiesService.deleteEntity(userId, entity.id)
            .then(() => navigation.popToTop())
            .catch((e) => Alert.alert('Error', getErrorMessage(e)));
        },
      },
    ]);
  };

  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!userId) return () => { active = false; };
      setLoadingActivities(true);
      timelinesService.getTimelines(userId)
        .then((list) => active && setTimelines(list))
        .catch((e) => active && setActivityError(getErrorMessage(e)))
        .finally(() => active && setLoadingActivities(false));
      return () => {
        active = false;
      };
    }, [userId]),
  );

  const activities = useMemo(
    () =>
      timelines
        .filter((t) => (t.entities ?? []).some((l) => l.entityId === entity.id))
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
    [timelines, entity.id],
  );

  // Money items for this entity: the linked timeline entries that carry a local
  // money attribution (role = given-out / owed-back), never sent to the backend.
  const moneyEntries = useMemo(
    () =>
      activities
        .filter((t) => t.moneyType != null && t.expenseAmountPaisa != null)
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
    [activities],
  );

  const moneyGivenTotal = useMemo(
    () =>
      moneyEntries
        .filter((t) => t.moneyType === 'expense')
        .reduce((sum, t) => sum + (t.expenseAmountPaisa ?? 0), 0),
    [moneyEntries],
  );

  const moneyReceivedTotal = useMemo(
    () =>
      moneyEntries
        .filter((t) => t.moneyType === 'receive')
        .reduce((sum, t) => sum + (t.expenseAmountPaisa ?? 0), 0),
    [moneyEntries],
  );

  // Receive/Ignore: writes ONLY the local status on the same timeline row (no
  // API call), then reflects it in the local list so the chip updates instantly.
  const markReceivable = useCallback(
    (item: Timeline, status: string) => {
      setTimelines((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, receivableStatus: status } : x)),
      );
      expensesService
        .setReceivableStatus(userId, item.id, status)
        .catch((e) => setActivityError(getErrorMessage(e)));
    },
    [userId],
  );

  const initial = entity.name ? entity.name[0].toUpperCase() : '?';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.name} numberOfLines={1}>{entity.name}</Text>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{entity.type}</Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Edit Entity"
              hitSlop={8}
              style={styles.actionButton}
              onPress={() => navigation.navigate('EditEntity', { entity })}>
              <Ionicons name="pencil-outline" size={18} color={theme.accent} />
            </Pressable>
            <Pressable
              accessibilityLabel="Delete Entity"
              hitSlop={8}
              style={styles.actionButton}
              onPress={confirmDelete}>
              <Ionicons name="trash-outline" size={18} color={theme.danger} />
            </Pressable>
          </View>
        </View>

        {entity.description ? (
          <Text style={styles.description} numberOfLines={2}>{entity.description}</Text>
        ) : null}
      </View>

      {moneyEntries.length > 0 ? (
        <View style={styles.moneyBlock}>
          <View style={styles.tlHeader}>
            <Text style={styles.sectionTitle}>Money</Text>
            <Text style={styles.entryCount}>
              {moneyEntries.length} {moneyEntries.length === 1 ? 'item' : 'items'}
            </Text>
          </View>
          <View style={styles.moneySummary}>
            <View style={styles.moneyStat}>
              <Text style={styles.moneyStatLabel}>Given</Text>
              <Text
                style={[styles.moneyStatValue, { color: theme.danger }]}>
                {formatPaise(moneyGivenTotal)}
              </Text>
            </View>
            <View style={styles.moneyStat}>
              <Text style={styles.moneyStatLabel}>Received</Text>
              <Text
                style={[styles.moneyStatValue, { color: theme.success }]}>
                {formatPaise(moneyReceivedTotal)}
              </Text>
            </View>
          </View>
          <View style={styles.moneyCard}>
            {moneyEntries.map((t, i) => (
              <MoneyRow
                key={t.id}
                item={t}
                isLast={i === moneyEntries.length - 1}
                onMark={markReceivable}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.tlHeader}>
        <Text style={styles.sectionTitle}>Timeline</Text>
        {activities.length > 0 && (
          <Text style={styles.entryCount}>
            {activities.length} {activities.length === 1 ? 'entry' : 'entries'}
          </Text>
        )}
      </View>

      {loadingActivities ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : activityError ? (
        <Text style={styles.noActivities}>{activityError}</Text>
      ) : activities.length === 0 ? (
        <Text style={styles.noActivities}>No timeline activity yet.</Text>
      ) : (
        <View style={styles.timeline}>
          {activities.map((t, index) => (
            <TimelineRow
              key={t.id}
              item={t}
              isLast={index === activities.length - 1}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function MoneyRow({
  item,
  isLast,
  onMark,
}: {
  item: Timeline;
  isLast: boolean;
  onMark?: (item: Timeline, status: string) => void;
}) {
  const theme = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const given = item.moneyType === 'expense';
  const tone = given ? theme.danger : theme.success;
  const receive = !given;
  const settled = receive && !isReceivablePending(item.receivableStatus);
  return (
    <View style={[styles.moneyRow, !isLast && styles.moneyRowBorder]}>
      <View style={[styles.moneyIcon, { backgroundColor: tone }]}>
        <Text style={styles.moneyEmoji}>{given ? '💸' : '💰'}</Text>
      </View>
      <View style={styles.moneyBody}>
        <Text style={styles.moneyTitle} numberOfLines={1}>
          {item.description?.trim() || item.title}
        </Text>
        <Text style={styles.moneyMeta}>{formatDate(item.eventDate)}</Text>
      </View>
      <View style={styles.moneyRight}>
        <Text style={[styles.moneyAmount, { color: tone }]}>
          {given ? '-' : '+'}
          {formatPaise(item.expenseAmountPaisa!)}
        </Text>
        {given ? (
          <Text style={styles.moneyStatus}>Given</Text>
        ) : settled ? (
          <Text
            style={[
              styles.moneyStatus,
              item.receivableStatus === 'received'
                ? { color: theme.success, fontWeight: '800' }
                : { color: theme.textSecondary },
            ]}>
            {item.receivableStatus}
          </Text>
        ) : onMark ? (
          <View style={styles.moneyActions}>
            <Pressable
              style={[styles.moneyChip, { borderColor: theme.success }]}
              onPress={() => onMark(item, 'received')}
              hitSlop={6}>
              <Text style={[styles.moneyChipText, { color: theme.success }]}>✓ Received</Text>
            </Pressable>
            <Pressable
              style={[styles.moneyChip, { borderColor: theme.border }]}
              onPress={() => onMark(item, 'ignored')}
              hitSlop={6}>
              <Text style={[styles.moneyChipText, { color: theme.textSecondary }]}>✕ Ignore</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.moneyStatus}>Pending</Text>
        )}
      </View>
    </View>
  );
}

function TimelineRow({ item, isLast }: { item: Timeline; isLast: boolean }) {
  const theme = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={styles.dot} />
        {!isLast && <View style={styles.connector} />}
      </View>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.entryCard, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((v) => !v)}>
        <View style={styles.entryHeader}>
          <Text style={styles.entryDate} numberOfLines={1}>{formatDate(item.eventDate)}</Text>
          <View style={styles.entryTimeWrap}>
            <Text style={styles.entryTime}>{formatTime(item.eventDate)}</Text>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.textSecondary}
            />
          </View>
        </View>
        <Text style={styles.entryTitle} numberOfLines={expanded ? undefined : 1}>
          {item.title}
        </Text>
        {item.description &&
        item.description.trim() !== item.title.trim() ? (
          <Text style={styles.entryDesc} numberOfLines={expanded ? undefined : 2}>
            {item.description}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  container: { padding: spacing.lg, paddingBottom: 40 },
  headerCard: {
    backgroundColor: t.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.lg,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { color: t.onAccent, fontSize: 18, fontWeight: '800' },
  headerInfo: { flex: 1 },
  name: { fontSize: 17, fontWeight: '800', color: t.text },
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: t.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    marginTop: 4,
    overflow: 'hidden',
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: t.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginLeft: spacing.sm },
  actionButton: {
    width: 34,
    height: 34,
    borderRadius: radii.full,
    backgroundColor: t.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: {
    fontSize: 13,
    color: t.textSecondary,
    lineHeight: 19,
    marginTop: spacing.md,
  },
  moneyBlock: { marginTop: spacing.lg },
  moneySummary: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  moneyStat: {
    flex: 1,
    backgroundColor: t.surfaceVariant,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  moneyStatLabel: { fontSize: 12, fontWeight: '600', color: t.textSecondary },
  moneyStatValue: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  moneyCard: {
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: spacing.md,
  },
  moneyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  moneyRowBorder: { borderBottomWidth: 1, borderBottomColor: t.borderFaint },
  moneyIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  moneyEmoji: { fontSize: 13 },
  moneyBody: { flex: 1, marginRight: spacing.sm },
  moneyTitle: { fontSize: 14, fontWeight: '600', color: t.text },
  moneyMeta: { fontSize: 11, color: t.textSecondary, marginTop: 2 },
  moneyRight: { alignItems: 'flex-end' },
  moneyAmount: { fontSize: 14, fontWeight: '800' },
  moneyActions: { flexDirection: 'row', gap: spacing.xs, marginTop: 4 },
  moneyChip: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  moneyChipText: { fontSize: 10, fontWeight: '700' },
  moneyStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: t.textSecondary,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  tlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: t.text },
  entryCount: { fontSize: 13, fontWeight: '600', color: t.textSecondary, marginLeft: spacing.sm },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  noActivities: {
    color: t.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    lineHeight: 20,
  },
  timeline: { marginBottom: spacing.sm },
  row: { flexDirection: 'row' },
  rail: { width: 24, alignItems: 'center' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.accent,
    marginTop: 6,
  },
  connector: {
    width: 2,
    backgroundColor: t.borderFaint,
    flex: 1,
    marginVertical: 4,
  },
  entryCard: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  entryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  entryDate: { fontSize: 12, fontWeight: '600', color: t.text, flex: 1 },
  entryTimeWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginLeft: spacing.sm },
  entryTime: { fontSize: 12, fontWeight: '600', color: t.textSecondary },
  entryTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginTop: spacing.sm, lineHeight: 21 },
  entryDesc: { fontSize: 13, color: t.textSecondary, marginTop: 2, lineHeight: 19 },
}) as const;