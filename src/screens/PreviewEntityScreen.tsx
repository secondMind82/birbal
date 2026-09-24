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
  // money attribution (role = debit / credit), never sent to the backend.
  const moneyEntries = useMemo(
    () =>
      activities
        .filter((t) => t.moneyType != null && t.expenseAmountPaisa != null)
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
    [activities],
  );

  // Financial summary splits credits by lifecycle: only money actually back
  // counts as Received; everything unresolved stays Pending. Debits = all
  // expense-direction entries connected to this entity. Every value defaults to
  // ₹0 when the entity has no transactions of that kind.
  const creditPendingTotal = useMemo(
    () =>
      moneyEntries
        .filter((t) => t.moneyType === 'receive' && isReceivablePending(t.receivableStatus))
        .reduce((sum, t) => sum + (t.expenseAmountPaisa ?? 0), 0),
    [moneyEntries],
  );

  const creditReceivedTotal = useMemo(
    () =>
      moneyEntries
        .filter((t) => t.moneyType === 'receive' && t.receivableStatus === 'received')
        .reduce((sum, t) => sum + (t.expenseAmountPaisa ?? 0), 0),
    [moneyEntries],
  );

  const debitTotal = useMemo(
    () =>
      moneyEntries
        .filter((t) => t.moneyType === 'expense')
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

      <View style={styles.moneyBlock}>
        <View style={styles.summaryHeader}>
          <Text style={styles.sectionTitle}>Financial Summary</Text>
        </View>
        <View style={styles.moneySummary}>
          <View style={styles.moneyStat}>
            <Text style={styles.moneyStatLabel}>Credit Pending</Text>
            <Text style={[styles.moneyStatValue, { color: theme.danger }]}>
              {formatPaise(creditPendingTotal)}
            </Text>
          </View>
          <View style={styles.moneyStat}>
            <Text style={styles.moneyStatLabel}>Credit Received</Text>
            <Text style={[styles.moneyStatValue, { color: theme.success }]}>
              {formatPaise(creditReceivedTotal)}
            </Text>
          </View>
          <View style={styles.moneyStat}>
            <Text style={styles.moneyStatLabel}>Total Debit</Text>
            <Text style={styles.moneyStatValue}>{formatPaise(debitTotal)}</Text>
          </View>
        </View>
      </View>

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
          {activities.map((t, index) =>
            t.moneyType != null && t.expenseAmountPaisa != null ? (
              <MoneyCard
                key={t.id}
                item={t}
                isLast={index === activities.length - 1}
                onMark={markReceivable}
                onOpen={(item) => navigation.navigate('PreviewTimeline', { timeline: item })}
              />
            ) : (
              <TimelineRow
                key={t.id}
                item={t}
                isLast={index === activities.length - 1}
                onOpen={(item) => navigation.navigate('PreviewTimeline', { timeline: item })}
              />
            ),
          )}
        </View>
      )}
    </ScrollView>
  );
}

function MoneyCard({
  item,
  isLast,
  onMark,
  onOpen,
}: {
  item: Timeline;
  isLast: boolean;
  onMark?: (item: Timeline, status: string) => void;
  onOpen: (item: Timeline) => void;
}) {
  const theme = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const given = item.moneyType === 'expense';
  const tone = given ? theme.danger : theme.success;
  const receive = !given;
  const settled = receive && !isReceivablePending(item.receivableStatus);
  const statusText = given
    ? 'Paid'
    : isReceivablePending(item.receivableStatus)
      ? 'Pending'
      : item.receivableStatus;
  const tagText = given
    ? `EXPENSE · ${item.expenseCategory ?? 'Other'} · ${statusText}`
    : `MONEY RECEIVABLE · ${statusText}`;
  return (
    <View style={[styles.moneyCard, !isLast && styles.moneyCardGap]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open timeline detail"
        style={({ pressed }) => pressed && { opacity: 0.7 }}
        onPress={() => onOpen(item)}>
        <View style={styles.moneyRow}>
          <View style={[styles.moneyIcon, { backgroundColor: tone }]}>
            <Text style={styles.moneyEmoji}>{given ? '💸' : '💰'}</Text>
          </View>
          <View style={styles.moneyBody}>
            <Text style={styles.moneyTitle} numberOfLines={2}>
              {item.description?.trim() || item.title}
            </Text>
            <Text style={[styles.moneyTag, { color: tone }]}>{tagText}</Text>
            <Text style={styles.moneyMeta}>{formatDate(item.eventDate)}</Text>
          </View>
          <View style={styles.moneyRight}>
            <Text style={[styles.moneyAmount, { color: tone }]}>
              {given ? '-' : '+'}
              {formatPaise(item.expenseAmountPaisa!)}
            </Text>
          </View>
        </View>
      </Pressable>
      {receive &&
      !settled &&
      onMark ? (
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
      ) : null}
    </View>
  );
}

function TimelineRow({
  item,
  isLast,
  onOpen,
}: {
  item: Timeline;
  isLast: boolean;
  onOpen: (item: Timeline) => void;
}) {
  const theme = useAppTheme();
  const styles = useAppStyles(makeStyles);
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={styles.dot} />
        {!isLast && <View style={styles.connector} />}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open timeline detail"
        style={({ pressed }) => [styles.entryCard, pressed && { opacity: 0.7 }]}
        onPress={() => onOpen(item)}>
        <View style={styles.entryHeader}>
          <Text style={styles.entryDate} numberOfLines={1}>{formatDate(item.eventDate)}</Text>
          <View style={styles.entryTimeWrap}>
            <Text style={styles.entryTime}>{formatTime(item.eventDate)}</Text>
          </View>
        </View>
        <Text style={styles.entryTitle} numberOfLines={1}>
          {item.title}
        </Text>
        {item.description &&
        item.description.trim() !== item.title.trim() ? (
          <Text style={styles.entryDesc} numberOfLines={2}>
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
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  moneySummary: { flexDirection: 'row', gap: spacing.md },
  moneyStat: {
    flex: 1,
    backgroundColor: t.surfaceVariant,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  moneyStatLabel: { fontSize: 11, fontWeight: '700', color: t.textSecondary },
  moneyStatValue: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  moneyCard: {
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md,
  },
  moneyCardGap: { marginBottom: spacing.md },
  moneyRow: { flexDirection: 'row', alignItems: 'center' },
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
  moneyTag: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  moneyMeta: { fontSize: 11, color: t.textSecondary, marginTop: 2 },
  moneyRight: { alignItems: 'flex-end' },
  moneyAmount: { fontSize: 15, fontWeight: '800' },
  moneyActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.borderFaint,
  },
  moneyChip: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  moneyChipText: { fontSize: 11, fontWeight: '700' },
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