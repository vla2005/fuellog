import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@/components/icons/AppIcons';
import {
  formatDisplayDateBR,
  getCalendarGridDays,
  getMonthHeaderLabel,
  getNextMonth,
  getPreviousMonth,
  handleDateRangeClick,
  isDateEnd,
  isDateInRange,
  isDateStart,
  parseIsoDate,
  WEEKDAY_HEADERS_PT,
} from '../helpers/calendarHelper';
import { useAppTheme } from '@/theme/ThemeProvider';
import { radii, typography } from '@/theme/tokens';

export interface CalendarRangePickerProps {
  initialStart: string | null;
  initialEnd: string | null;
  onConfirm: (start: string | null, end: string | null) => void;
  onSelectAllHistory: () => void;
}

export function CalendarRangePicker({
  initialStart,
  initialEnd,
  onConfirm,
  onSelectAllHistory,
}: CalendarRangePickerProps) {
  const { colors, isDark } = useAppTheme();

  // Rascunho interno enquanto estiver no seletor de calendário
  const [draftStart, setDraftStart] = useState<string | null>(initialStart);
  const [draftEnd, setDraftEnd] = useState<string | null>(initialEnd);

  // Mês e ano exibidos no calendário (inicializa pelo início selecionado ou pela data atual)
  const initialYearMonth = useMemo(() => {
    if (initialStart) {
      const parsed = parseIsoDate(initialStart);
      if (parsed) {
        return { year: parsed.year, monthIndex: parsed.monthIndex };
      }
    }
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  }, [initialStart]);

  const [currentView, setCurrentView] = useState<{ year: number; monthIndex: number }>(
    initialYearMonth,
  );

  const gridCells = useMemo(() => {
    return getCalendarGridDays(currentView.year, currentView.monthIndex);
  }, [currentView.year, currentView.monthIndex]);

  const handlePrevMonth = () => {
    setCurrentView((prev) => getPreviousMonth(prev.year, prev.monthIndex));
  };

  const handleNextMonth = () => {
    setCurrentView((prev) => getNextMonth(prev.year, prev.monthIndex));
  };

  const handleCellPress = (dateStr: string) => {
    const nextRange = handleDateRangeClick(draftStart, draftEnd, dateStr);
    setDraftStart(nextRange.start);
    setDraftEnd(nextRange.end);
  };

  const handleConfirm = () => {
    // Se o usuário selecionou apenas a data inicial e não a final, assume início até fim igual
    const finalStart = draftStart;
    const finalEnd = draftEnd ?? draftStart;
    onConfirm(finalStart, finalEnd);
  };

  const handleAllHistoryPress = () => {
    setDraftStart(null);
    setDraftEnd(null);
    onSelectAllHistory();
  };

  return (
    <View style={styles.container}>
      {/* Cards de Início e Fim lado a lado */}
      <View style={styles.summaryRow}>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: colors.bgSecondary,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <Text style={[styles.summaryCardLabel, { color: colors.textSecondary }]}>
            Início
          </Text>
          <Text
            style={[
              styles.summaryCardValue,
              { color: colors.textPrimary },
            ]}
          >
            {formatDisplayDateBR(draftStart)}
          </Text>
        </View>

        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: colors.bgSecondary,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <Text style={[styles.summaryCardLabel, { color: colors.textSecondary }]}>
            Fim
          </Text>
          <Text
            style={[
              styles.summaryCardValue,
              { color: colors.textPrimary },
            ]}
          >
            {formatDisplayDateBR(draftEnd)}
          </Text>
        </View>
      </View>

      {/* Navegação de Mês */}
      <View style={styles.monthNavRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mês anterior"
          onPress={handlePrevMonth}
          style={[styles.navArrowBtn, { backgroundColor: colors.bgSecondary }]}
        >
          <ChevronLeftIcon size={18} color={colors.textPrimary} />
        </Pressable>

        <Text style={[styles.monthNavTitle, { color: colors.textPrimary }]}>
          {getMonthHeaderLabel(currentView.year, currentView.monthIndex)}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Próximo mês"
          onPress={handleNextMonth}
          style={[styles.navArrowBtn, { backgroundColor: colors.bgSecondary }]}
        >
          <ChevronRightIcon size={18} color={colors.textPrimary} />
        </Pressable>
      </View>

      {/* Cabeçalho dos dias da semana (Seg a Dom) */}
      <View style={styles.weekdaysRow}>
        {WEEKDAY_HEADERS_PT.map((dayLabel) => (
          <Text
            key={dayLabel}
            style={[styles.weekdayCell, { color: colors.textSecondary }]}
          >
            {dayLabel}
          </Text>
        ))}
      </View>

      {/* Grid de Dias do Calendário */}
      <View style={styles.gridWrap}>
        {gridCells.map((cell, idx) => {
          if (!cell) {
            return <View key={`empty-${idx}`} style={styles.daySlotEmpty} />;
          }

          const isStart = isDateStart(cell.dateStr, draftStart);
          const isEnd = isDateEnd(cell.dateStr, draftEnd);
          const inRange = isDateInRange(cell.dateStr, draftStart, draftEnd);
          const isSelected = isStart || isEnd;

          let cellBg = 'transparent';
          let textColor = colors.textPrimary;

          if (isSelected) {
            cellBg = colors.accentPrimary;
            textColor = '#FFFFFF';
          } else if (inRange) {
            cellBg = colors.accentSoft;
            textColor = isDark ? '#FFFFFF' : colors.textPrimary;
          }

          return (
            <Pressable
              key={cell.dateStr}
              accessibilityRole="button"
              accessibilityLabel={`${cell.dayNumber} de ${getMonthHeaderLabel(currentView.year, currentView.monthIndex)}${
                isStart ? ', início selecionado' : isEnd ? ', fim selecionado' : inRange ? ', no intervalo' : ''
              }`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => handleCellPress(cell.dateStr)}
              style={[
                styles.daySlot,
                {
                  backgroundColor: cellBg,
                  borderRadius: isSelected ? radii.md : inRange ? 0 : radii.md,
                },
              ]}
            >
              <Text
                style={[
                  styles.dayText,
                  {
                    color: textColor,
                    fontWeight: isSelected ? '700' : '500',
                  },
                ]}
              >
                {cell.dayNumber}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Instrução de Ajuda */}
      <Text style={[styles.hintText, { color: colors.textSecondary }]}>
        Toque na data inicial e depois na final.
      </Text>

      {/* Botões de Ação Inferiores */}
      <View style={styles.bottomActionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Todo o histórico"
          onPress={handleAllHistoryPress}
          style={styles.allHistoryBtn}
        >
          <Text style={[styles.allHistoryBtnText, { color: colors.accentPrimary }]}>
            Todo o histórico
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Usar período"
          onPress={handleConfirm}
          style={[styles.usePeriodBtn, { backgroundColor: colors.accentPrimary }]}
        >
          <Text style={styles.usePeriodBtnText}>Usar período</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  summaryCardLabel: {
    ...typography.caption,
    fontSize: 12,
    marginBottom: 2,
  },
  summaryCardValue: {
    ...typography.cardTitle,
    fontSize: 16,
    fontWeight: '700',
  },
  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  navArrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavTitle: {
    ...typography.cardTitle,
    fontSize: 17,
    fontWeight: '700',
  },
  weekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  weekdayCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  daySlotEmpty: {
    width: `${100 / 7}%`,
    height: 42,
  },
  daySlot: {
    width: `${100 / 7}%`,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },
  dayText: {
    fontSize: 15,
  },
  hintText: {
    ...typography.caption,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 24,
  },
  bottomActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingBottom: 8,
  },
  allHistoryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  allHistoryBtnText: {
    ...typography.bodyStrong,
    fontSize: 15,
    fontWeight: '600',
  },
  usePeriodBtn: {
    borderRadius: radii.pill,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  usePeriodBtnText: {
    ...typography.bodyStrong,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
