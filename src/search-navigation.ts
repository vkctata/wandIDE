export function searchFocusIndex(key: string, current: number, count: number): number | null {
  if (!count) return null;
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
  if (current >= 0 && key === 'Home') return 0;
  if (current >= 0 && key === 'End') return count - 1;
  return null;
}
