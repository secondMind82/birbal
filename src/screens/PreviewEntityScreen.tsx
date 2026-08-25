import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Card } from '../components/ui';
import { deleteEntity } from '../api/apiService';
import { getErrorMessage } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

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

      <Button title="Edit" onPress={() => navigation.navigate('EditEntity', { entity })} />
      <Button title="Delete" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
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
});
