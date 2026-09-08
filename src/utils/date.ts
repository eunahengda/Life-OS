const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Format check alone (DATE_PATTERN) isn't enough — new Date('2028-02-30')
// silently rolls over to March instead of throwing, so it would let
// impossible calendar dates like 2028-02-30 or 2028-99-99 through.
export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

// Parses the YYYY-MM-DD string's components directly rather than through
// `new Date(value)`, which treats it as UTC midnight and can display as the
// previous day in negative-UTC-offset timezones.
export function formatDisplayDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}
