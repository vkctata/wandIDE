/** Guard before React's next render so rapid clicks cannot enqueue two runs. */
export async function submitOnce(
  lock: { current: boolean },
  submit: () => Promise<void>,
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  try {
    await submit();
    return true;
  } finally {
    lock.current = false;
  }
}
