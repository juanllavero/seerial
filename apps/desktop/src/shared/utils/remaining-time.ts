import type { TFunction } from 'i18next';

/** "3 h 47 min remaining" / "Quedan 3 h 47 min", in the interface language. */
export function formatRemainingTime(remainingMinutes: number, t: TFunction): string {
  const total = Math.max(Math.round(remainingMinutes), 1);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const hoursText = hours > 0 ? t('durationHours', { count: hours }) : '';
  const minutesText = minutes > 0 ? t('durationMinutes', { count: minutes }) : '';

  const time = [hoursText, minutesText].filter(Boolean).join(' ');

  // The verb agrees with the first number of the sentence: "Queda 1 h 30 min"
  return t('remainingTime', { count: hours || minutes, time });
}
