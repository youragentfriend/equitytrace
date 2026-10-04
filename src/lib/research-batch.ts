export async function runResearchBatch<T, R>(items: T[], execute: (item: T, index: number) => Promise<R>, limit: number): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      const [result] = await Promise.allSettled([execute(items[index]!, index)]);
      results[index] = result;
    }
  }));
  return results;
}
