import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { radii, spacing, useAppStyles, useAppTheme } from '../theme';
import type { BirbalTheme } from '../theme';
import { formatPaise, moneyToneColors, type MoneyPresentation } from '../utils/money';

/**
 * The financial block on a Timeline card.
 *
 * Timeline has always shown the amount and the Paid/Received/Pending status; this
 * presents those same facts as their own labelled section so a credit is
 * distinguishable from a debit at a glance. It renders nothing of its own for a
 * non-money row — the caller skips it entirely in that case.
 *
 * The colour comes from MoneyPresentation.tone, which is derived from the stored
 * columns by utils/money, so this component never has to re-derive what a record
 * means. Every tone uses a very light wash with a 1px accent rather than a filled
 * block, which keeps the card premium and readable.
 */

const TONE_ICON: Record<MoneyPresentation['tone'], keyof typeof Ionicons.glyphMap> = {
  received: 'checkmark-circle',
  pending: 'hourglass-outline',
  debit: 'card-outline',
  ignored: 'close-circle-outline',
};

export default function MoneyPanel({ money }: { money: MoneyPresentation }) {
  const t = useAppTheme();
  const styles = useAppStyles(makeStyles);
  // Only the accent comes from the tone here: the card behind this block already
  // carries the light wash, so the section itself stays on the plain surface and
  // reads as a nested card rather than disappearing into its parent.
  const { accent } = moneyToneColors(t, money.tone);

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${money.amountLabel}, ${formatPaise(money.amountPaise)}, ${money.statusLabel}`}
      style={[styles.panel, { borderColor: accent }]}>
      <View style={styles.topRow}>
        <View style={styles.labelRow}>
          <Ionicons name={TONE_ICON[money.tone]} size={14} color={accent} />
          <Text style={[styles.amountLabel, { color: accent }]}>{money.amountLabel}</Text>
        </View>
        <View style={[styles.badge, { borderColor: accent }]}>
          <Text style={[styles.badgeText, { color: accent }]}>{money.statusLabel}</Text>
        </View>
      </View>

      <Text style={styles.amount} allowFontScaling>
        {formatPaise(money.amountPaise)}
      </Text>

      {money.category ? (
        <Text style={styles.category} numberOfLines={1}>
          {money.category}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (t: BirbalTheme) =>
  ({
    panel: {
      marginTop: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      backgroundColor: t.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    labelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      flexShrink: 1,
    },
    amountLabel: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    badge: {
      borderWidth: 1,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
    amount: {
      marginTop: spacing.xs,
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: -0.5,
      color: t.text,
    },
    category: {
      marginTop: 2,
      fontSize: 11,
      fontWeight: '600',
      color: t.textSecondary,
    },
  }) as const;
