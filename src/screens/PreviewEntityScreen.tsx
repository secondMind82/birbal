import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card } from '../components/ui';
import { deleteEntity, getTimelines } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import type { Timeline } from '../models/types';
import { colors, radii, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PreviewEntity'>;

const TYPE_ICONS: Record<string, string> = {
  PERSON: '👤',
  PLACE: '📍',
  ORGANIZATION: '🏢',
  EVENT: '📅',
};

export default function PreviewEntityScreen({ route, navigation }: Props) {
  const { entity } = route.params;

  const confirmDelete = () => {
    Alert.alert('Delete Entity', `"${entity.name}" will be deleted permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteEntity(entity.id)
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
      setLoadingActivities(true);
      getTimelines()
        .then((list) => active && setTimelines(list))
        .catch((e) => active && setActivityError(getErrorMessage(e)))
        .finally(() => active && setLoadingActivities(false));
      return () => {
        active = false;
      };
    }, []),
  );

  const activities = useMemo(
    () =>
      timelines
        .filter((t) => (t.entities ?? []).some((l) => l.entityId === entity.id))
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
    [timelines, entity.id],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <View style={styles.headerRow}>
          <Text style={styles.icon}>{TYPE_ICONS[entity.type] ?? '👤'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{entity.name}</Text>
            <Text style={styles.type}>{entity.type}</Text>
          </View>
        </View>
        {entity.description ? (
          <Text style={styles.description}>{entity.description}</Text>
        ) : (
          <Text style={[styles.description, styles.muted]}>No description added.</Text>
        )}
      </Card>

      <Text style={styles.timelineHeader}>Activities</Text>
      {loadingActivities ? (
        <View style={styles.activitiesCenter}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : activityError ? (
        <Text style={styles.noActivities}>{activityError}</Text>
      ) : activities.length === 0 ? (
        <Text style={styles.noActivities}>
          No activities for {entity.name} yet. Post on the Timeline mentioning @{entity.name}.
        </Text>
      ) : (
        activities.map((t) => (
          <Pressable
            key={t.id}
            style={({ pressed }) => [styles.activityCard, pressed && { opacity: 0.7 }]}
            onPress={() => navigation.navigate('PreviewTimeline', { timeline: t })}>
            <View style={styles.activityDateBox}>
              <Text style={styles.activityDay}>{(t.eventDate ?? '').slice(8, 10)}</Text>
              <Text style={styles.activityMonth}>{monthShort(t.eventDate)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.activityTitle} numberOfLines={2}>
                {t.title}
              </Text>
              <Text style={styles.activityDesc} numberOfLines={1}>
                {t.description}
              </Text>
            </View>
          </Pressable>
        ))
      )}

      <Button title="Edit" onPress={() => navigation.navigate('EditEntity', { entity })} />
      <Button title="Delete" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

function monthShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en', { month: 'short' }).toUpperCase();
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: 40, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { fontSize: 36 },
  name: { fontSize: 22, fontWeight: '800', color: colors.text },
  type: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
    backgroundColor: '#EEF2FF',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 2,
    borderRadius: 999,
    marginTop: 4,
    overflow: 'hidden',
  },
  description: { marginTop: spacing.lg, fontSize: 15, lineHeight: 24, color: colors.text },
  muted: { color: colors.textSecondary, fontStyle: 'italic' },
  timelineHeader: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  activitiesCenter: { paddingVertical: spacing.xl, alignItems: 'center' },
  noActivities: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    lineHeight: 20,
  },
  activityCard: {
    backgroundColor: '#fff',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  activityDateBox: {
    width: 52,
    height: 56,
    borderRadius: radii.sm,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityDay: { fontSize: 20, fontWeight: '800', color: colors.accent },
  activityMonth: { fontSize: 11, fontWeight: '700', color: colors.accent },
  activityTitle: { fontWeight: '700', fontSize: 15, color: colors.text },
  activityDesc: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
});
