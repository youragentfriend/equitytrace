export function sortDatedEvents<T extends { date?: string }>(events: T[], now = Date.now()) {
  return [...events].sort((left, right) => {
    const leftTime = left.date ? new Date(left.date).getTime() : Number.NaN;
    const rightTime = right.date ? new Date(right.date).getTime() : Number.NaN;
    const leftUpcoming = Number.isFinite(leftTime) && leftTime >= now;
    const rightUpcoming = Number.isFinite(rightTime) && rightTime >= now;
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
    if (!Number.isFinite(leftTime)) return 1;
    if (!Number.isFinite(rightTime)) return -1;
    return leftUpcoming ? leftTime - rightTime : rightTime - leftTime;
  });
}
