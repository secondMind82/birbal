import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AppShell from '../components/AppShell';
import { getErrorMessage } from '../api/client';
import type { Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as timelinesService from '../services/timelinesService';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Nav = NativeStackNavigationProp<import('../navigation/types').RootStackParamList>;

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarScreen() {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const navigation = useNavigation<Nav>();
  const userId = useAuthStore((s) => s.user?.id);
  const [events, setEvents] = useState<Timeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!userId) return () => { active = false; };

      (async () => {
        try {
          const cached = await timelinesService.getCachedTimelines(userId);
          if (active) {
            setEvents(cached);
            setLoading(false);
          }
        } catch {
          if (active) setLoading(false);
          return;
        }

        try {
          const fresh = await timelinesService.getTimelines(userId);
          if (active) {
            setEvents(fresh);
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

  const calendarEvents = useMemo(
    () => events.filter((e) => e.showOnCalendar),
    [events],
  );

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return calendarEvents;
    return calendarEvents.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    );
  }, [calendarEvents, search]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, Timeline[]>();
    filteredEvents.forEach((e) => {
      const key = (e.eventDate ?? '').slice(0, 10);
      if (!key) return;
      map.set(key, [...(map.get(key) ?? []), e]);
    });
    return map;
  }, [filteredEvents]);

  const grid = useMemo(() => {
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: (string | null)[] = Array(firstWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(
        `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      );
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [selectedMonth]);

  const todayKey = new Date().toISOString().slice(0, 10);

  const dayEvents = useMemo(
    () => (eventsByDay.get(selectedDate) ?? []).sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
    [eventsByDay, selectedDate],
  );

  const upcomingEvents = useMemo(
    () =>
      filteredEvents
        .filter((e) => (e.eventDate ?? '').slice(0, 10) > selectedDate)
        .sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
    [filteredEvents, selectedDate],
  );

  const selectedLabel = useMemo(() => {
    const d = new Date(`${selectedDate}T00:00:00`);
    if (isNaN(d.getTime())) return selectedDate;
    return d.toLocaleDateString('en', { day: 'numeric', month: 'short' });
  }, [selectedDate]);

  const goToday = () => {
    const now = new Date();
    setSelectedMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(now.toISOString().slice(0, 10));
  };

  const formatFullDate = (dateStr: string): string => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  };

  if (loading) {
    return (
      <AppShell title="Calendar">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={t.accent} />
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell title="Calendar">
      <ScrollView contentContainerStyle={styles.container}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search events in calendar..."
          placeholderTextColor={t.textSecondary}
        />

        <View style={styles.calendarCard}>
          <View style={styles.monthRow}>
            <Pressable
              onPress={() =>
                setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1))
              }>
              <Text style={styles.navArrow}>‹</Text>
            </Pressable>
            <Pressable onPress={goToday} style={styles.todayBtn}>
              <Text style={styles.todayBtnText}>Today</Text>
            </Pressable>
            <Text style={styles.monthLabel}>
              {selectedMonth.toLocaleString('en', { month: 'long', year: 'numeric' })}
            </Text>
            <Pressable
              onPress={() =>
                setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1))
              }>
              <Text style={styles.navArrow}>›</Text>
            </Pressable>
          </View>

          <View style={styles.weekHeader}>
            {WEEK_DAYS.map((d) => (
              <Text key={d} style={styles.weekDay}>
                {d}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {grid.map((row, ri) => (
              <View key={`row-${ri}`} style={styles.gridRow}>
                {row.map((day, ci) => {
                  if (!day) return <View key={`empty-${ri}-${ci}`} style={styles.cell} />;
                  const dayNum = parseInt(day.slice(8), 10);
                  const hasEvents = eventsByDay.has(day);
                  const isToday = day === todayKey;
                  const isSelected = day === selectedDate;
                  return (
                    <Pressable key={day} style={styles.cell} onPress={() => setSelectedDate(day)}>
                      <View
                        style={[
                          styles.dayCircle,
                          isSelected && styles.daySelected,
                          !isSelected && isToday && styles.dayToday,
                        ]}>
                        <Text
                          style={[
                            styles.dayText,
                            isToday && !isSelected && styles.dayTextToday,
                            isSelected && styles.dayTextSelected,
                          ]}>
                          {dayNum}
                        </Text>
                      </View>
                      {hasEvents ? (
                        <View style={[styles.dot, isSelected && { backgroundColor: t.accent }]} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        {/* Events on selected date */}
        <Text style={styles.sectionTitle}>Events on {selectedLabel}</Text>
        {dayEvents.length === 0 ? (
          <Text style={styles.emptySmall}>No events on this day.</Text>
        ) : (
          dayEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onPress={() => navigation.navigate('PreviewTimeline', { timeline: event })}
            />
          ))
        )}

        {/* Upcoming events */}
        <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Upcoming Events</Text>
        {upcomingEvents.length === 0 ? (
          <Text style={styles.emptySmall}>No upcoming events.</Text>
        ) : (
          upcomingEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onPress={() => navigation.navigate('PreviewTimeline', { timeline: event })}
            />
          ))
        )}

        {error ? <Text style={styles.empty}>{error}</Text> : null}
        <View style={{ height: 40 }} />
      </ScrollView>
    </AppShell>
  );
}

function EventCard({ event, onPress }: { event: Timeline; onPress: () => void }) {
  const styles = useAppStyles(makeStyles);
  return (
    <Pressable
      style={({ pressed }) => [styles.eventCard, pressed && { opacity: 0.7 }]}
      onPress={onPress}>
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle}>{event.title}</Text>
        <Text style={styles.eventDesc} numberOfLines={1}>
          {event.description}
        </Text>
        <Text style={styles.eventDate}>{formatEventDate(event.eventDate)}</Text>
      </View>
    </Pressable>
  );
}

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const makeStyles = (t: BirbalTheme) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: spacing.lg },
  search: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: t.text,
    marginBottom: spacing.md,
  },
  calendarCard: {
    backgroundColor: t.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navArrow: { fontSize: 26, color: t.accent, paddingHorizontal: spacing.md, fontWeight: '700' },
  todayBtn: {
    backgroundColor: t.accent,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  todayBtnText: { color: t.onAccent, fontSize: 12, fontWeight: '700' },
  monthLabel: { fontSize: 16, fontWeight: '800', color: t.text },
  weekHeader: { flexDirection: 'row', marginBottom: 4 },
  weekDay: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: t.textSecondary,
  },
  grid: { },
  gridRow: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: { backgroundColor: t.accent },
  dayToday: { borderWidth: 1.5, borderColor: t.accent },
  dayText: { fontSize: 13, color: t.text },
  dayTextToday: { color: t.accent, fontWeight: '700' },
  dayTextSelected: { color: t.onAccent, fontWeight: '700' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: t.danger, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: spacing.sm },
  emptySmall: { color: t.textSecondary, fontSize: 13, marginBottom: spacing.sm },
  empty: { color: t.textSecondary, textAlign: 'center', marginTop: spacing.xl },
  eventCard: {
    backgroundColor: t.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  eventInfo: { flex: 1 },
  eventTitle: { fontSize: 15, fontWeight: '700', color: t.text },
  eventDesc: { fontSize: 13, color: t.textSecondary, marginTop: 2 },
  eventDate: { fontSize: 12, color: t.accent, fontWeight: '600', marginTop: 6 },
}) as const;
