/** Internal ordering for reproducible export ownership, independent of host locale. @module */

/** Compares UTF-16 code units without invoking locale-sensitive collation. */
export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
