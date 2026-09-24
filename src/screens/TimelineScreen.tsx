import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AppShell from '../components/AppShell';
import { getErrorMessage } from '../api/client';
import { Card, EmptyState } from '../components/ui';
import type { Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as timelinesService from '../services/timelinesService';
import { activityEmoji, parseActivity } from '../utils/activityParser';
import { formatPaise } from '../utils/money';
import { radii, shadows, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Nav = NativeStackNavigationProp<import('../navigation/types').RootStackParamList>;

type MenuAnchor = { timeline: Timeline; top: number; right: number };

function formatStamp(event: Timeline): string {
  const d = new Date(event.eventDate);
  if (isNaN(d.getTime())) return '';
  const datePart = d.toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  const timeSource = hasTime ? event.eventDate : event.createdAt ?? '';
  if (timeSource) {
    const c = new Date(timeSource);
    if (!isNaN(c.getTime())) {
      const time = c.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
      return `${datePart} · ${time}`;
    }
  }
  return datePart;
}

export default function TimelineScreen() {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore((s) => s.user?.id);
  const [events, setEvents] = useState<Timeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!userId) return () => { active = false; };

      (async () => {
        try {
          const cached = await timelinesService.getCachedTimelines(userId);
          if (active) {
            setEvents(
              [...cached].sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
            );
            setLoading(false);
          }
        } catch {
          if (active) setLoading(false);
          return;
        }

        try {
          const fresh = await timelinesService.getTimelines(userId);
          if (active) {
            setEvents(
              [...fresh].sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
            );
            setError(null);
          }
        } catch (e) {
          if (active) setError(getErrorMessage(e));
        }
      })();

      return () => {
        active = false;
      };
    }, [userId]),
  );

  const handleEdit = (timeline: Timeline) => {
    setMenu(null);
    navigation.navigate('EditTimeline', { timeline });
  };

  const handleDelete = (timeline: Timeline) => {
    setMenu(null);
    Alert.alert('Delete Event', `"${timeline.title}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setEvents((prev) => prev.filter((e) => e.id !== timeline.id));
          timelinesService
            .deleteTimeline(userId, timeline.id)
            .catch((e) => Alert.alert('Error', getErrorMessage(e)));
        },
      },
    ]);
  };

  if (loading) {
    return (
      <AppShell title="Timeline">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={t.accent} />
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell title="Timeline">
      <View style={styles.flex}>
        <FlatList
          contentContainerStyle={styles.container}
          data={events}
          keyExtractor={(item) => `e-${item.id}`}
          ListEmptyComponent={
            error ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <EmptyState icon="📅" message="No events yet. Tap + to add one." />
            )
          }
          renderItem={({ item }) => (
            <TimelineCard
              event={item}
              onOpenMenu={setMenu}
            />
          )}
        />
        {menu ? (
          <Modal transparent visible animationType="fade" onRequestClose={() => setMenu(null)}>
            <Pressable style={styles.backdrop} onPress={() => setMenu(null)}>
              <View style={[styles.menu, { top: menu.top, right: menu.right }]}>
                <Pressable style={styles.menuItem} onPress={() => handleEdit(menu.timeline)}>
                  <Text style={styles.menuEmoji}>✏️</Text>
                  <Text style={styles.menuText}>Edit</Text>
                </Pressable>
                <Pressable style={styles.menuItem} onPress={() => handleDelete(menu.timeline)}>
                  <Text style={styles.menuEmoji}>🗑️</Text>
                  <Text style={[styles.menuText, styles.menuTextDanger]}>Delete</Text>
                </Pressable>
              </View>
            </Pressable>
          </Modal>
        ) : null}
        <Pressable style={styles.fab} onPress={() => navigation.navigate('AddEvent')}>
          <Text style={styles.fabIcon}>+</Text>
        </Pressable>
      </View>
    </AppShell>
  );
}

function TimelineCard({
  event,
  onOpenMenu,
}: {
  event: Timeline;
  onOpenMenu: (anchor: MenuAnchor) => void;
}) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const [expanded, setExpanded] = useState(false);
  const dotsRef = useRef<View>(null);

  const description = event.description ?? '';
  const parsed = parseActivity(description);
  const hasPlaceTag = /#\w/.test(description);

  const category = parsed.matched
    ? parsed.title
        .split(' ')
        .filter((w) => /[A-Za-z]/.test(w))
        .join(' ')
    : hasPlaceTag
      ? 'PLACE'
      : 'NOTE';
  const emoji = parsed.matched
    ? activityEmoji(parsed.title)
    : hasPlaceTag
      ? '📍'
      : '📝';

  const headline = parsed.matched && parsed.message ? parsed.message : '';
  const body = description.trim() || event.title || '';
  const stamp = formatStamp(event);

  const tags = (event.entities ?? []).map((l) => ({
    key: l.entity.id,
    label:
      l.entity.type === 'PERSON'
        ? `@${l.entity.name}`
        : l.entity.type === 'PLACE'
          ? `#${l.entity.name}`
          : l.entity.name,
  }));

  const openMenu = () => {
    const { width } = Dimensions.get('window');
    dotsRef.current?.measureInWindow((x, y, w, h) => {
      onOpenMenu({
        timeline: event,
        top: y + h + 6,
        right: Math.max(spacing.md, width - x - w),
      });
    });
  };

  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setExpanded((v) => !v)}>
        <View style={styles.headerRow}>
          <View style={styles.iconTile}>
            <Text style={styles.iconText}>{emoji}</Text>
          </View>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText} numberOfLines={1}>{category}</Text>
          </View>
          <View style={styles.headerSpacer} />
          <View ref={dotsRef} collapsable={false}>
            <Pressable
              accessibilityLabel="More options"
              hitSlop={8}
              onPress={openMenu}>
              <Ionicons name="ellipsis-vertical" size={18} color={t.textSecondary} />
            </Pressable>
          </View>
          <Pressable
            accessibilityLabel={expanded ? 'Collapse timeline' : 'Expand timeline'}
            hitSlop={8}
            onPress={() => setExpanded((v) => !v)}>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={t.textSecondary}
            />
          </Pressable>
        </View>

        {headline ? (
          <Text style={styles.headline} numberOfLines={expanded ? undefined : 2}>
            {headline}
          </Text>
        ) : null}
        <Text style={styles.bodyText} numberOfLines={expanded ? undefined : 3}>
          {body}
        </Text>

        {tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {tags.map((tag) => (
              <View key={tag.key} style={styles.tag}>
                <Text style={styles.tagText}>{tag.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.stampRow}>
          {event.expenseAmountPaisa != null ? (
            <Text style={styles.amountText}>
              {formatPaise(event.expenseAmountPaisa)} · {event.expenseCategory ?? 'Other'}
            </Text>
          ) : null}
          <Text style={styles.stampText}>{stamp}</Text>
        </View>
      </Pressable>
    </Card>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: spacing.lg, paddingBottom: 80, flexGrow: 1 },
  card: {
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 16 },
  categoryBadge: {
    backgroundColor: t.accentSoft,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: '58%',
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: t.accent,
    textTransform: 'uppercase',
  },
  headerSpacer: { flex: 1 },
  headline: {
    fontSize: 15,
    fontWeight: '700',
    color: t.text,
    lineHeight: 21,
    marginTop: spacing.md,
  },
  bodyText: { fontSize: 14, color: t.textSecondary, lineHeight: 20, marginTop: spacing.xs },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  tag: {
    backgroundColor: t.accentSoft,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  tagText: { fontSize: 12, fontWeight: '600', color: t.accent },
  stampRow: { marginTop: spacing.md, alignItems: 'flex-end' },
  amountText: {
    fontSize: 13,
    fontWeight: '800',
    color: t.accent,
    marginBottom: 3,
  },
  stampText: { fontSize: 11, color: t.textSecondary, letterSpacing: 0.1 },
  backdrop: { flex: 1, backgroundColor: t.scrim },
  menu: {
    position: 'absolute',
    width: 156,
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    paddingVertical: spacing.xs,
    ...shadows.md,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  menuEmoji: { fontSize: 14 },
  menuText: { fontSize: 14, fontWeight: '600', color: t.text, flex: 1 },
  menuTextDanger: { color: t.danger },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabIcon: { color: t.onAccent, fontSize: 28, marginTop: -2 },
  error: { color: t.danger, textAlign: 'center', marginTop: spacing.xl },
}) as const;
