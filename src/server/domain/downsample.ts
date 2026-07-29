/**
 * Largest Triangle Three Buckets (LTTB) ダウンサンプリング。
 * 折れ線の見た目を保ったままデータ点数を threshold まで減らす。
 * 平均化せず実データ点を選ぶため、値が偽物にならず最初と最後の点も必ず残る。
 */
export function lttb<T>(
  data: readonly T[],
  threshold: number,
  getX: (d: T) => number,
  getY: (d: T) => number,
): readonly T[] {
  const n = data.length;
  if (threshold >= n || threshold < 3) return data;

  const sampled: T[] = [data[0]!];    // 最初の点は必ず残す
  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0;                          // 直前に選んだ点のインデックス

  for (let i = 0; i < threshold - 2; i++) {
    // 次バケットの平均座標
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    const rangeLen = rangeEnd - rangeStart || 1;
    let avgX = 0, avgY = 0;
    for (let j = rangeStart; j < rangeEnd; j++) {
      avgX += getX(data[j]!);
      avgY += getY(data[j]!);
    }
    avgX /= rangeLen;
    avgY /= rangeLen;

    // 現バケット内で「直前の点・次バケット平均」と作る三角形の面積が最大の点を選ぶ
    const bucketStart = Math.floor(i * bucketSize) + 1;
    const bucketEnd = Math.floor((i + 1) * bucketSize) + 1;
    const ax = getX(data[a]!), ay = getY(data[a]!);
    let maxArea = -1, chosen = bucketStart;
    for (let j = bucketStart; j < bucketEnd && j < n; j++) {
      const area = Math.abs(
        (ax - avgX) * (getY(data[j]!) - ay) - (ax - getX(data[j]!)) * (avgY - ay),
      );
      if (area > maxArea) { maxArea = area; chosen = j; }
    }
    sampled.push(data[chosen]!);
    a = chosen;
  }

  sampled.push(data[n - 1]!);         // 最後の点も必ず残す
  return sampled;
}
