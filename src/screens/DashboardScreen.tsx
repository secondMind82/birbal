import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import AppShell from '../components/AppShell';
import {
  createEntity,
  createNote,
  createTimeline,
  getDashboard,
  getEntities,
  getTimelines,
} from '../api/apiService';
import { getErrorMessage } from '../api/client';
import { Card } from '../components/ui';
import type { DashboardResponse, Entity, Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';
import { colors, radii, spacing } from '../theme';

type Nav = NativeStackNavigationProp<import('../navigation/types').RootStackParamList>;

const before = (s: string, sep: string) =>
  s.includes(sep) ? s.slice(0, s.indexOf(sep)) : s;

function extractDateTime(text: string): Date {
  const result = new Date();
  const timeMatch = text.match(/(\d{1,2})(:(\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    const amPm = timeMatch[4].toLowerCase();
    if (amPm === 'pm' && hour < 12) hour += 12;
    if (amPm === 'am' && hour === 12) hour = 0;
    result.setHours(hour, minute, 0, 0);
  }
  const dateMatch = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dateMatch) {
    result.setFullYear(
      parseInt(dateMatch[3], 10),
      parseInt(dateMatch[2], 10) - 1,
      parseInt(dateMatch[1], 10),
    );
  }
  return result;
}

function greetingInfo(): { text: string; emoji: string } {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return { text: 'Good Morning', emoji: '🌅' };
  if (h >= 12 && h < 17) return { text: 'Good Afternoon', emoji: '☀️' };
  if (h >= 17 && h < 21) return { text: 'Good Evening', emoji: '🌆' };
  return { text: 'Good Night', emoji: '🌙' };
}

export default function DashboardScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAuthStore((s) => s.user);

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [recentTimelines, setRecentTimelines] = useState<Timeline[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [postText, setPostText] = useState('');
  const inputRef = useRef<TextInput>(null);

  const userName = user?.fullName ?? user?.email ?? '';
  const firstName = userName.split(' ')[0];
  const greeting = greetingInfo();

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [dash, ents, timelines] = await Promise.all([
        getDashboard(),
        getEntities(),
        getTimelines(),
      ]);
      setData(dash);
      setEntities(ents);
      setRecentTimelines(
        [...timelines]
          .sort((a, b) => b.eventDate.localeCompare(a.eventDate))
          .slice(0, 5),
      );
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const mentionQuery = (() => {
    const m = postText.match(/(?:^|\s)@([^\s]*)$/);
    return m ? m[1].toLowerCase() : null;
  })();

  const suggestions =
    mentionQuery !== null
      ? entities.filter((e) => e.name.toLowerCase().includes(mentionQuery)).slice(0, 5)
      : [];

  const applySuggestion = (entity: Entity) => {
    setPostText((prev) => prev.replace(/@([^\s]*)$/, `@${entity.name} `));
    inputRef.current?.focus();
  };

  const handlePost = async () => {
    const text = postText.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (!text.includes('@')) {
        const rawTitle =
          text.length > 30 ? `${before(text.slice(0, 30), '\n')}...` : before(text, '\n');
        await createNote({ title: rawTitle, content: text, pinned: false });
      } else {
        const linkedIds: string[] = [];
        const mentions: string[] = [];
        const atIndices: number[] = [];
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '@' && (i === 0 || /\s/.test(text[i - 1]))) atIndices.push(i);
        }

        const sorted = [...entities].sort((a, b) => b.name.length - a.name.length);
        for (const idx of atIndices) {
          const remaining = text.slice(idx + 1);
          const match = sorted.find((e) =>
            remaining.toLowerCase().startsWith(e.name.toLowerCase()),
          );
          if (match) {
            linkedIds.push(match.id);
            mentions.push(`@${remaining.slice(0, match.name.length)}`);
          } else {
            const word = remaining.split(/[\s.,]/)[0];
            if (word) {
              const created = await createEntity({
                name: word,
                type: 'PERSON',
                description: 'Automatically created via post.',
              });
              linkedIds.push(created.id);
              setEntities((prev) => [...prev, created]);
              mentions.push(`@${word}`);
            }
          }
        }

        const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

        let description = text;
        mentions.forEach((mention) => {
          description = description.replaceAll(mention, mention.slice(1));
        });
        if (emailMatch) {
          description += `\n\n--- Meeting Scheduled ---\nOrganizer: ${user?.email ?? ''}\nAttendee: ${emailMatch[0]}`;
        }

        const title =
          description.length > 35
            ? `${before(description.slice(0, 35), '\n')}...`
            : before(description, '\n');

        await createTimeline({
          title,
          description,
          eventDate: extractDateTime(text).toISOString(),
          showOnCalendar: true,
          entityIds: [...new Set(linkedIds)],
        });
      }
      setPostText('');
      await fetchAll();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell title="Dashboard">
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
        <Text style={styles.greeting}>
          {greeting.text} {greeting.emoji}
        </Text>
        <Text style={styles.fullName}>{firstName || 'User'}</Text>
        <Text style={styles.subtitle}>Ready to capture some memories today?</Text>

        {/* Capture-a-moment post box */}
        <Card style={styles.postCard}>
          <Text style={styles.postHeading}>Capture a moment</Text>
          <View>
            <TextInput
              ref={inputRef}
              style={styles.postInput}
              value={postText}
              onChangeText={setPostText}
              placeholder="What's on your mind? Use @ to link people"
              placeholderTextColor={colors.textSecondary}
              multiline
            />
            {suggestions.length > 0 && (
              <View style={styles.suggestions}>
                <ScrollView style={{ maxHeight: 160 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {suggestions.map((e) => (
                    <Pressable
                      key={e.id}
                      style={styles.suggestionRow}
                      onPress={() => applySuggestion(e)}>
                      <Text style={styles.suggestionName}>{e.name}</Text>
                      <Text style={styles.suggestionType}>{e.type}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
          <Pressable
            onPress={() => void handlePost()}
            disabled={!postText.trim() || loading}
            style={({ pressed }) => [
              styles.postButton,
              (!postText.trim() || loading || pressed) && { opacity: 0.6 },
            ]}>
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.postButtonText}>Post to Timeline</Text>
            )}
          </Pressable>
        </Card>

        {error ? <Text style={styles.error}>Error: {error}</Text> : null}

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickRow}>
          <QuickAction icon="👤" label="Add Entity" sub="Add contacts" onPress={() => navigation.navigate('NewEntity')} />
          <QuickAction icon="📅" label="Add Event" sub="Schedule important" onPress={() => navigation.navigate('AddEvent')} />
        </View>
        <QuickAction icon="📝" label="Add Note" sub="Capture an idea" onPress={() => navigation.navigate('NewNote')} wide />

        {/* Recent Timeline */}
        <View style={[styles.sectionHeader]}>
          <Text style={styles.sectionTitleBig}>Recent Timeline</Text>
        </View>
        {recentTimelines.length === 0 ? (
          <Text style={styles.emptyLine}>Your timeline is empty. Start posting!</Text>
        ) : (
          recentTimelines.map((event) => (
            <TimelinePreviewCard
              key={event.id}
              event={event}
              onClick={() => navigation.navigate('PreviewTimeline', { timeline: event })}
            />
          ))
        )}

        {/* Recent Diary */}
        {data?.recentDiary && data.recentDiary.length > 0 && (
          <>
            <Text style={[styles.sectionTitleBig, { marginTop: spacing.lg }]}>Recent Diary</Text>
            {data.recentDiary.map((entry) => (
              <Card key={entry.id} style={styles.diaryCard}>
                <Pressable onPress={() => navigation.navigate('PreviewDiary', { entry })}>
                  <View style={styles.diaryRow}>
                    <Text style={{ fontSize: 20 }}>📖</Text>
                    <View>
                      <Text style={styles.diaryTitle}>{entry.title}</Text>
                      <Text style={styles.diaryDate}>{before(entry.entryDate, 'T')}</Text>
                    </View>
                  </View>
                </Pressable>
              </Card>
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </AppShell>
  );
}

function QuickAction({
  icon,
  label,
  sub,
  onPress,
  wide = false,
}: {
  icon: string;
  label: string;
  sub?: string;
  onPress: () => void;
  wide?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.quickAction, wide && { width: '100%' }, pressed && { opacity: 0.7 }]}
      onPress={onPress}>
      <Text style={styles.quickIcon}>{icon}</Text>
      <Text style={styles.quickLabel}>{label}</Text>
      {sub ? <Text style={styles.quickSub}>{sub}</Text> : null}
    </Pressable>
  );
}

function TimelinePreviewCard({ event, onClick }: { event: Timeline; onClick: () => void }) {
  let cleanTitle: string = event.title.replace(/@/g, '');
  event.entities?.forEach((link) => {
    cleanTitle = cleanTitle.replace(new RegExp(link.entity.name, 'ig'), '');
  });
  cleanTitle = cleanTitle.trim().replace(/\s+/g, ' ') || 'Event Details';

  return (
    <Card style={styles.timelineCard}>
      <Pressable onPress={onClick}>
        <View style={styles.timelineRow}>
          <View style={styles.timelineIconBox}>
            <Text style={{ fontSize: 22 }}>📅</Text>
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.timelineTitle} numberOfLines={1}>
              {cleanTitle}
            </Text>
            <Text style={styles.timelineDate}>{before(event.eventDate, 'T')}</Text>
          </View>
          {event.entities && event.entities.length > 0 && (
            <View style={styles.entityChip}>
              <Text style={styles.entityChipText} numberOfLines={1}>
                {event.entities.map((l) => l.entity.name).join(', ')}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexOne: { flex: 1 },
  container: { padding: spacing.xl, backgroundColor: '#F9FAFB' },
  greeting: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  fullName: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 2 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  postCard: { borderRadius: radii.lg },
  postHeading: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: spacing.md },
  postInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 90,
    textAlignVertical: 'top',
    color: colors.text,
    fontSize: 14,
  },
  suggestions: {
    backgroundColor: '#fff',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    marginTop: 4,
    elevation: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F9FAFB',
  },
  suggestionName: { fontWeight: '600', color: '#111827', fontSize: 14 },
  suggestionType: { marginLeft: 'auto', fontSize: 11, color: colors.accent, fontWeight: '700' },
  postButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  postButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: spacing.xl, marginBottom: spacing.md },
  sectionTitleBig: { fontSize: 19, fontWeight: '800', marginBottom: spacing.md },
  sectionHeader: { marginTop: spacing.xl, marginBottom: spacing.sm },
  quickRow: { flexDirection: 'row', gap: spacing.md },
  quickAction: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
  },
  quickIcon: { fontSize: 26, marginBottom: spacing.xs },
  quickLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  quickSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  emptyLine: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  timelineCard: { marginBottom: spacing.md },
  timelineRow: { flexDirection: 'row', alignItems: 'center' },
  timelineIconBox: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  timelineTitle: { fontWeight: '700', fontSize: 15, color: '#111827' },
  timelineDate: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  entityChip: {
    backgroundColor: '#EEF2FF',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginLeft: spacing.sm,
    maxWidth: 100,
  },
  entityChipText: { fontSize: 11, color: colors.accent, fontWeight: '700' },
  diaryCard: { marginBottom: spacing.sm },
  diaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  diaryTitle: { fontWeight: '600', fontSize: 15, color: '#111827' },
  diaryDate: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
