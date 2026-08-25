import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Card, Chip } from '../components/ui';
import { deleteTimeline } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

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

  const date = new Date(timeline.eventDate);
  const dateStr = isNaN(date.getTime())
    ? timeline.eventDate
    : date.toLocaleString('en', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <Text style={styles.date}>{dateStr}</Text>
        <Text style={styles.title}>{timeline.title}</Text>
        <Text style={styles.description}>{timeline.description}</Text>

        {timeline.entities && timeline.entities.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Linked Entities</Text>
            <View style={styles.chipsRow}>
              {timeline.entities.map((l) => (
                <Chip key={l.entityId} text={`@${l.entity.name}`} />
              ))}
            </View>
          </>
        )}

        <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Calendar</Text>
        <Text style={{ color: colors.textSecondary }}>
          {timeline.showOnCalendar ? 'Shown on calendar' : 'Hidden from calendar'}
        </Text>
      </Card>

      <Button title="Edit" onPress={() => navigation.navigate('EditTimeline', { timeline })} />
      <Button title="Delete" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: 40, gap: spacing.md },
  date: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
    textTransform: 'uppercase',
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: spacing.xs },
  description: { fontSize: 15, lineHeight: 24, color: colors.text, marginTop: spacing.md },
  sectionLabel: { fontWeight: '700', fontSize: 13, color: colors.textSecondary, marginTop: spacing.lg },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
