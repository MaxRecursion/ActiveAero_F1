/**
 * 1-D interpolation through a few key values. Bodies are described as a handful of stations
 * (like a designer's section drawings) and sampled densely in between.
 */

export type Keys = readonly (readonly [x: number, value: number])[];

function sorted(keys: Keys): (readonly [number, number])[] {
  return [...keys].sort((a, b) => a[0] - b[0]);
}

/** Straight lines between keys; used where a shape must change abruptly (cockpit walls). */
export function linear(keys: Keys): (x: number) => number {
  const k = sorted(keys);
  return (x) => {
    if (x <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) {
      if (x <= k[i][0]) {
        const t = (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
        return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * t;
      }
    }
    return k[k.length - 1][1];
  };
}

/**
 * Cubic Hermite with Catmull-Rom style tangents (non-uniform spacing): a smooth, fair curve through
 * every key, so lofted bodies have no ripples between stations.
 */
export function smooth(keys: Keys): (x: number) => number {
  const k = sorted(keys);
  const n = k.length;
  const slope = (i: number) => {
    const a = k[Math.max(0, i - 1)];
    const b = k[Math.min(n - 1, i + 1)];
    return b[0] === a[0] ? 0 : (b[1] - a[1]) / (b[0] - a[0]);
  };
  return (x) => {
    if (x <= k[0][0]) return k[0][1];
    if (x >= k[n - 1][0]) return k[n - 1][1];
    let i = 1;
    while (x > k[i][0]) i++;
    const [x0, y0] = k[i - 1];
    const [x1, y1] = k[i];
    const h = x1 - x0;
    const t = (x - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * y0 +
      (t3 - 2 * t2 + t) * h * slope(i - 1) +
      (-2 * t3 + 3 * t2) * y1 +
      (t3 - t2) * h * slope(i)
    );
  };
}

/** `count` values from a to b inclusive. */
export function range(a: number, b: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => a + ((b - a) * i) / (count - 1));
}
