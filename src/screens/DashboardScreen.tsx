import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { LinearGradient } from 'expo-linear-gradient';
import AppShell from '../components/AppShell';
import { getErrorMessage } from '../api/client';
import { Card } from '../components/ui';
import type { DiaryEntry, Entity, Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';
import * as diaryService from '../services/diaryService';
import * as entitiesService from '../services/entitiesService';
import * as timelinesService from '../services/timelinesService';
import {
  classifyEntityType,
  extractEventDate,
  formatRelativeTime,
  parseActivity,
  sanitizeName,
} from '../utils/activityParser';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

type Nav = NativeStackNavigationProp<import('../navigation/types').RootStackParamList>;



const before = (s: string, sep: string) =>
  s.includes(sep) ? s.slice(0, s.indexOf(sep)) : s;

function defaultTitle(description: string): string {
  return description.length > 35
    ? `${before(description.slice(0, 35), '\n')}...`
    : before(description, '\n');
}

function greetingInfo(): { text: string; emoji: string } {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return { text: 'Good Morning', emoji: '🌅' };
  if (h >= 12 && h < 17) return { text: 'Good Afternoon', emoji: '☀️' };
  if (h >= 17 && h < 21) return { text: 'Good Evening', emoji: '🌆' };
  return { text: 'Good Night', emoji: '🌙' };
}

function findEntityByName(rawName: string, entities: Entity[]): Entity | undefined {
  const target = sanitizeName(rawName).toLowerCase();
  if (!target) return undefined;

  const candidates = entities.filter((e) => sanitizeName(e.name).toLowerCase().includes(target));
  if (candidates.length === 0) return undefined;

  // Prefer exact sanitized match
  const exact = candidates.find((e) => sanitizeName(e.name).toLowerCase() === target);
  if (exact) return exact;

  // If multiple candidates, pick the one with most linked timelines (most active)
  if (timelines && timelines.length > 0) {
    let best: Entity | undefined = undefined;
    let bestCount = -1;
    for (const c of candidates) {
      const count = timelines.filter((t) => (t.entities ?? []).some((l) => l.entityId === c.id)).length;
      if (count > bestCount) {
        best = c;
        bestCount = count;
      }
    }
    if (best) return best;
  }

  // Fallback: starts-with then contains
  const starts = candidates.find((e) => sanitizeName(e.name).toLowerCase().startsWith(target));
  if (starts) return starts;
  return candidates[0];
}

export default function DashboardScreen() {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  const navigation = useNavigation<Nav>();
  const user = useAuthStore((s) => s.user);
  const userId = useAuthStore((s) => s.user?.id);

  const [entities, setEntities] = useState<Entity[]>([]);
  const [recentTimelines, setRecentTimelines] = useState<Timeline[]>([]);
  const [recentDiary, setRecentDiary] = useState<DiaryEntry[]>([]);
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [postText, setPostText] = useState('');
  const inputRef = useRef<TextInput>(null);

  const userName = user?.fullName ?? user?.email ?? '';
  const firstName = userName.split(' ')[0];
  const greeting = greetingInfo();

  const applyTimelines = useCallback((all: Timeline[]) => {
    setTimelines(all);
    setRecentTimelines(
      [...all].sort((a, b) => b.eventDate.localeCompare(a.eventDate)).slice(0, 5),
    );
  }, []);

  const recentGroups = useMemo<{ groups: TimelineGroup[]; strays: Timeline[] }>(() => {
    const map = new Map<string, TimelineGroup>();
    const strays: Timeline[] = [];
    for (const t of recentTimelines) {
      const link = (t.entities ?? []).find((l) => l.entity?.type === 'PERSON') ?? (t.entities ?? [])[0];
      const entity = link?.entity;
      if (!entity) {
        strays.push(t);
        continue;
      }
      const existing = map.get(entity.id);
      if (existing) {
        existing.entries.push(t);
      } else {
        map.set(entity.id, { entity, entries: [t] });
      }
    }
    const groups = [...map.values()].map((g) => ({
      ...g,
      entries: [...g.entries].sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
    }));
    groups.sort((a, b) => b.entries[0].eventDate.localeCompare(a.entries[0].eventDate));
    return { groups, strays };
  }, [recentTimelines]);

  const fetchAll = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const [ents, timelineList, diaryEntries] = await Promise.all([
        entitiesService.getEntities(userId),
        timelinesService.getTimelines(userId),
        diaryService.getDiary(userId),
      ]);
      setEntities(ents);
      applyTimelines(timelineList);
      setRecentDiary(
        [...diaryEntries].sort((a, b) => b.entryDate.localeCompare(a.entryDate)),
      );
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [userId, applyTimelines]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const refreshAll = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const [ents, timelineList, diaryEntries] = await Promise.all([
        entitiesService.refreshEntities(userId),
        timelinesService.refreshTimelines(userId),
        diaryService.refreshDiary(userId),
      ]);
      setEntities(ents);
      applyTimelines(timelineList);
      setRecentDiary(
        [...diaryEntries].sort((a, b) => b.entryDate.localeCompare(a.entryDate)),
      );
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, [userId, applyTimelines]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  }, [refreshAll]);

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
      if (!text.includes('@') && !text.includes('#')) {
        const firstNameWord = sanitizeName(text.split(/\s+/)[0] || '');
        let personId: string | null = null;
        let personName = firstNameWord;
        if (firstNameWord) {
          const existing = findEntityByName(firstNameWord, entities);
          if (existing) {
            personId = existing.id;
            personName = existing.name;
          } else {
            const created = await entitiesService.createEntity(user?.id, {
              name: firstNameWord,
              type: 'PERSON',
              description: 'Automatically created via post.',
            });
            personId = created.id;
            personName = created.name;
            setEntities((prev) => [...prev, created]);
          }
        }

        const description = text;
        const parsed = parseActivity(description, personName);
        const title = parsed.matched && parsed.title ? parsed.title : defaultTitle(description);
        await timelinesService.createTimeline(userId, {
          title,
          description,
          eventDate: extractEventDate(text).toISOString(),
          showOnCalendar: true,
          entityIds: personId ? [personId] : [],
        });
      } else {
        const linkedIds: string[] = [];
        const mentions: string[] = [];

        // Use regex to capture mention words robustly (stop at whitespace or punctuation)
        const mentionMatches = Array.from(text.matchAll(/@([^\s@.,!?:;\n\r]+)/g));
        for (const m of mentionMatches) {
          const raw = m[1] ?? '';
          const word = sanitizeName(raw);
          if (!word) continue;

          const existing = findEntityByName(word, entities);
          if (existing) {
            linkedIds.push(existing.id);
            mentions.push(`@${raw}`);
          } else {
            const created = await entitiesService.createEntity(user?.id, {
              name: word,
              type: classifyEntityType(word),
              description: 'Automatically created via post.',
            });
            linkedIds.push(created.id);
            setEntities((prev) => [...prev, created]);
            mentions.push(`@${word}`);
          }
        }

        // #place → PLACE entity (mirrors @mention behavior; original text is kept as-is)
        const placeMatches = Array.from(text.matchAll(/#([^\s@.,!?:;\n\r]+)/g));
        for (const m of placeMatches) {
          const raw = m[1] ?? '';
          const word = sanitizeName(raw);
          if (!word) continue;

          const existing = findEntityByName(word, entities);
          if (existing) {
            linkedIds.push(existing.id);
          } else {
            const created = await entitiesService.createEntity(user?.id, {
              name: word,
              type: 'PLACE',
              description: 'Automatically created via post.',
            });
            linkedIds.push(created.id);
            setEntities((prev) => [...prev, created]);
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

        const parsed = parseActivity(description, mentions[0]?.slice(1));
        const title = parsed.matched && parsed.title ? parsed.title : defaultTitle(description);

        await timelinesService.createTimeline(userId, {
          title,
          description,
          eventDate: extractEventDate(text).toISOString(),
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
        {/* Premium greeting hero */}
        <View style={styles.hero}>
          <LinearGradient
            colors={[t.accentSoft, 'rgba(250, 247, 241, 0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.heroGradient}
          />
          <View style={styles.heroGlow} />
          <View style={styles.heroSun}>
            <View style={styles.heroSunCore} />
          </View>
          <View style={styles.heroArc} />
          <View style={styles.heroRow}>
            <View style={styles.heroText}>
              <Text style={styles.heroOverline}>
                {greeting.text.toUpperCase()}  {greeting.emoji}
              </Text>
              <Text style={styles.heroTitle} numberOfLines={2}>
                Hey, <Text style={styles.heroAccent}>{firstName || 'User'}</Text>
              </Text>
            </View>
            <View style={styles.heroAvatar}>
              <Text style={styles.heroAvatarText}>
                {firstName ? firstName[0].toUpperCase() : 'U'}
              </Text>
            </View>
          </View>
        </View>

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
              placeholderTextColor={t.textSecondary}
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

        {/* Recent Timeline */}
        <View style={[styles.sectionHeader]}>
          <Text style={styles.sectionTitleBig}>Recent Timeline</Text>
        </View>
        {recentTimelines.length === 0 ? (
          <Text style={styles.emptyLine}>Your timeline is empty. Start posting!</Text>
        ) : (
          <>
            {recentGroups.groups.map((group) => (
              <TimelineGroupCard
                key={group.entity.id}
                group={group}
                onClick={() => navigation.navigate('PreviewEntity', { entity: group.entity })}
              />
            ))}
            {recentGroups.strays.map((event) => (
              <TimelinePreviewCard
                key={event.id}
                event={event}
                onClick={() => navigation.navigate('PreviewTimeline', { timeline: event })}
              />
            ))}
          </>
        )}

        {/* Recent Diary */}
        {recentDiary.length > 0 && (
          <>
            <Text style={[styles.sectionTitleBig, { marginTop: spacing.lg }]}>Recent Diary</Text>
            {recentDiary.map((entry) => (
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

function TimelinePreviewCard({ event, onClick }: { event: Timeline; onClick: () => void }) {
  const styles = useAppStyles(makeStyles);
  const personName =
    event.entities?.find((l) => l.entity.type === 'PERSON')?.entity.name ??
    (event.description ?? '').trim().split(/\s+/)[0] ??
    '';
  const letter = personName ? personName[0].toUpperCase() : '?';
  const timeLabel = formatRelativeTime(event.createdAt ?? event.eventDate);
  const parsed = parseActivity(event.description ?? '');

  return (
    <Card style={styles.timelineCardCompact}>
      <Pressable onPress={onClick}>
        <View style={styles.feedHeaderCompact}>
          <View style={styles.feedAvatarCompact}>
            <Text style={styles.feedAvatarText}>{letter}</Text>
          </View>
          <View style={styles.feedHeaderTextCompact}>
            <Text style={styles.feedName}>{personName}</Text>
            <Text style={styles.feedMeta}>{timeLabel}</Text>
          </View>
        </View>

        <View style={styles.previewBody}>
          <View style={styles.feedTitleRowCompact}>
            <Text style={styles.feedTitleCompact} numberOfLines={1}>
              {parsed.title || parsed.message || (event.description ?? '').split('\n')[0]
                || event.title}
            </Text>
            <Text style={styles.feedMetaCompact}>{parsed.details[0]?.emoji ?? ''}</Text>
          </View>

          {parsed.message ? (
            <Text style={styles.feedMessageCompact} numberOfLines={2}>{parsed.message}</Text>
          ) : null}
        </View>
      </Pressable>
    </Card>
  );
}

type TimelineGroup = { entity: Entity; entries: Timeline[] };

function TimelineGroupCard({
  group,
  onClick,
}: {
  group: TimelineGroup;
  onClick: () => void;
}) {
  const styles = useAppStyles(makeStyles);
  const letter = group.entity.name ? group.entity.name[0].toUpperCase() : '?';
  const latest = group.entries[0];
  const timeLabel = formatRelativeTime(latest?.createdAt ?? latest?.eventDate ?? '');

  return (
    <Card style={styles.timelineCardCompact}>
      <Pressable onPress={onClick}>
        <View style={styles.feedHeaderCompact}>
          <View style={styles.feedAvatarCompact}>
            <Text style={styles.feedAvatarText}>{letter}</Text>
          </View>
          <View style={styles.feedHeaderTextCompact}>
            <Text style={styles.feedName}>{group.entity.name}</Text>
            <Text style={styles.feedMeta}>
              {timeLabel} · {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
            </Text>
          </View>
        </View>

        {group.entries.map((event) => {
          const parsed = parseActivity(event.description ?? '');
          return (
            <View key={event.id} style={styles.groupEntry}>
              <View style={styles.feedTitleRowCompact}>
                <Text style={styles.feedTitleCompact} numberOfLines={1}>
                  {parsed.title || parsed.message || (event.description ?? '').split('\n')[0]
                    || event.title}
                </Text>
                <Text style={styles.feedMetaCompact}>{parsed.details[0]?.emoji ?? ''}</Text>
              </View>
              {parsed.message ? (
                <Text style={styles.feedMessageCompact} numberOfLines={1}>{parsed.message}</Text>
              ) : null}
            </View>
          );
        })}

        <View style={styles.viewAllRow}>
          <Text style={styles.viewAllText}>View all →</Text>
        </View>
      </Pressable>
    </Card>
  );
}



const makeStyles = (t: BirbalTheme) => ({
  flex: { flex: 1 },
  container: { padding: spacing.xl, backgroundColor: t.surfaceVariant },
  hero: { position: 'relative', marginBottom: spacing.sm, overflow: 'hidden' },
  heroGradient: { position: 'absolute', top: -32, left: -24, right: -24, bottom: 0 },
  heroGlow: {
    position: 'absolute',
    top: -28,
    right: -30,
    width: 184,
    height: 184,
    borderRadius: radii.full,
    backgroundColor: t.accentSoft,
    opacity: 0.9,
  },
  heroSun: {
    position: 'absolute',
    top: -8,
    right: 96,
    width: 62,
    height: 62,
    borderRadius: radii.full,
    backgroundColor: 'rgba(224, 184, 132, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSunCore: {
    width: 16,
    height: 16,
    borderRadius: radii.full,
    backgroundColor: 'rgba(210, 170, 105, 0.55)',
  },
  heroArc: {
    position: 'absolute',
    bottom: 8,
    right: 10,
    width: 92,
    height: 46,
    borderTopWidth: 2,
    borderColor: 'rgba(192, 163, 122, 0.32)',
    borderTopLeftRadius: 46,
    borderTopRightRadius: 46,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  heroText: { flex: 1, paddingRight: spacing.md },
  heroOverline: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: t.textSecondary,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: t.text,
    marginTop: spacing.sm,
  },
  heroAccent: { color: t.accent, fontWeight: '800' },
  heroAvatar: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1C1530',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  heroAvatarText: { fontSize: 17, fontWeight: '700', color: t.accent },
  postCard: { borderRadius: radii.lg },
  postHeading: { fontSize: 16, fontWeight: '700', color: t.text, marginBottom: spacing.md },
  postInput: {
    backgroundColor: t.surfaceVariant,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 44,
    textAlignVertical: 'center',
    color: t.text,
    fontSize: 14,
  },
  suggestions: {
    backgroundColor: t.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: t.surfaceVariant,
    marginTop: 4,
    elevation: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.surfaceVariant,
  },
  suggestionName: { fontWeight: '600', color: t.text, fontSize: 14 },
  suggestionType: { marginLeft: 'auto', fontSize: 11, color: t.accent, fontWeight: '700' },
  postButton: {
    backgroundColor: t.accent,
    borderRadius: radii.sm,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  postButtonText: { color: t.onAccent, fontWeight: '700', fontSize: 15 },
  error: { color: t.danger, fontSize: 13, marginTop: spacing.md },
  sectionTitleBig: { fontSize: 19, fontWeight: '800', marginBottom: spacing.md },
  sectionHeader: { marginTop: spacing.xl, marginBottom: spacing.sm },
  emptyLine: { color: t.textSecondary, fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  timelineCard: { marginBottom: spacing.md, padding: spacing.lg },
  timelineCardCompact: {
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  feedHeaderCompact: { flexDirection: 'row', alignItems: 'center' },
  feedAvatarCompact: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  feedHeaderTextCompact: { flex: 1 },
  feedTitleRowCompact: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feedTitleCompact: {
    fontSize: 14,
    fontWeight: '600',
    color: t.text,
    flex: 1,
  },
  feedMetaCompact: { marginLeft: spacing.sm, fontSize: 15 },
  feedMessageCompact: { fontSize: 13, color: t.textSecondary, marginTop: 2, lineHeight: 18 },
  previewBody: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.borderFaint,
  },
  feedHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  feedAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedAvatarText: { color: t.onAccent, fontSize: 16, fontWeight: '800' },
  feedHeaderText: { marginLeft: spacing.md, flex: 1 },
  feedName: { fontSize: 16, fontWeight: '700', color: t.text },
  feedMeta: { fontSize: 12, color: t.textSecondary, marginTop: 2 },
  feedTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: t.text,
    marginBottom: spacing.md,
    letterSpacing: 0.2,
  },
  detailSection: { marginBottom: spacing.sm },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    marginBottom: 3,
    backgroundColor: t.surfaceVariant,
    borderRadius: radii.sm,
  },
  detailEmoji: { fontSize: 15, marginRight: spacing.sm, marginTop: 1, width: 22, textAlign: 'center' },
  detailContent: { flex: 1 },
  detailLabel: { fontSize: 11, fontWeight: '600', color: t.border, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontSize: 14, fontWeight: '600', color: t.text, marginTop: 1 },
  messageBox: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.surfaceVariant,
  },
  feedMessage: { fontSize: 13, color: t.textSecondary, lineHeight: 20 },
  diaryCard: { marginBottom: spacing.sm },
  diaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  diaryTitle: { fontWeight: '600', fontSize: 15, color: t.text },
  diaryDate: { fontSize: 12, color: t.textSecondary, marginTop: 2 },
  groupEntry: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.borderFaint,
  },
  viewAllRow: { marginTop: spacing.md, alignItems: 'flex-end' },
  viewAllText: { color: t.accent, fontWeight: '700', fontSize: 13, letterSpacing: 0.2 },
  /* Entity preview styles */
}) as const;
