// Ensures auth endpoints take a minimum time so timing attacks cannot reveal
// whether a user/email exists in the system.
export const withConstantDelay = async <T>(
  fn: () => Promise<T>,
  minDelayMs: number = 500
): Promise<T> => {
  const start = Date.now();
  const result = await fn();
  const elapsed = Date.now() - start;
  if (elapsed < minDelayMs) {
    await new Promise<void>((r) => setTimeout(r, minDelayMs - elapsed));
  }
  return result;
};
