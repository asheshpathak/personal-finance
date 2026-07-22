/**
 * Reference-counted body scroll lock.
 *
 * The naive version — save `body.style.overflow`, set 'hidden', restore on
 * cleanup — breaks in two ways this app actually hits:
 *
 *  1. React StrictMode double-invokes effects in dev, so the saved value is
 *     captured a second time *after* the lock is applied. The restore then
 *     writes 'hidden' back permanently and scrolling is dead until reload.
 *  2. Radix dialogs apply their own body lock. If one opens while the mobile
 *     drawer is open, the same stale-capture problem occurs across owners.
 *
 * Counting locks means only the first acquire snapshots the original value and
 * only the last release restores it.
 */
let lockCount = 0;
let savedOverflow: string | null = null;

export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return; // guard against a cleanup running twice
    released = true;
    lockCount -= 1;
    if (lockCount === 0) {
      document.body.style.overflow = savedOverflow ?? '';
      savedOverflow = null;
    }
  };
}
