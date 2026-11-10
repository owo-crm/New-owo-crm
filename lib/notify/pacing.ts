/** Resend's default rate is two requests/second; reserve spaced slots within each worker. */
export function createEmailPacer(
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let next = 0;
  return async () => {
    const current = now();
    const scheduled = Math.max(current, next);
    next = scheduled + 600;
    const delay = scheduled - current;
    if (delay) await wait(delay);
  };
}
