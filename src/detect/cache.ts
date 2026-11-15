/** Remembers the last computed value and reuses it while every key part is identical. */
export class Memo<T> {
  private last?: { key: unknown[]; value: T };

  get(key: unknown[], compute: () => T): T {
    if (this.last && this.last.key.length === key.length && this.last.key.every((k, i) => k === key[i])) {
      return this.last.value;
    }
    const value = compute();
    this.last = { key, value };
    return value;
  }

  clear(): void {
    this.last = undefined;
  }
}
