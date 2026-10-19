/** Apply a bounded number of asynchronous workers while retaining source order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  transform: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer");
  }
  const results = Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await transform(items[index]!, index);
      }
    })
  );
  return results;
}
