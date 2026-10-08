import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';

export type BirbalChatRole = 'user' | 'assistant';

/**
 * One chat bubble in the AI Assistant conversation. Purely presentational —
 * rendering only, no data or navigation access.
 */
export default function BirbalChatMessage({
  role,
  text,
  typing = false,
}: {
  role: BirbalChatRole;
  text: string;
  typing?: boolean;
}) {
  const styles = useAppStyles(makeStyles);

  if (role === 'user') {
    return (
      <View style={styles.rowUser}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.rowAssistant}>
      <View style={styles.avatar}>
        <MaterialCommunityIcons name="robot" size={14} color="#FFFFFF" />
      </View>
      <View style={[styles.assistantBubble, typing && styles.typingBubble]}>
        <Text style={[styles.assistantText, typing && styles.typingText]}>
          {typing ? 'Birbal is thinking…' : text}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (t: BirbalTheme) => ({
  rowUser: { alignItems: 'flex-end' },
  rowAssistant: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    maxWidth: '92%',
  },
  userBubble: {
    backgroundColor: t.accent,
    borderRadius: radii.lg,
    borderBottomRightRadius: radii.xs,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 1,
    maxWidth: '82%',
  },
  userText: { color: '#FFFFFF', fontSize: 14, lineHeight: 20 },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantBubble: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radii.lg,
    borderBottomLeftRadius: radii.xs,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 1,
    flexShrink: 1,
  },
  typingBubble: { backgroundColor: t.surfaceVariant, borderColor: t.border },
  typingText: { color: t.textSecondary, fontStyle: 'italic' },
  assistantText: { color: t.text, fontSize: 14, lineHeight: 20 },
}) as const;
