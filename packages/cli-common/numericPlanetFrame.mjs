/** Dependency-free numeric globe owner, shared by terminal and generated installer renderers. */
export function createNumericPlanetFrame(options = {}) {
  const width = Math.min(30, Math.max(8, Math.floor(options.columns ?? 30)));
  // Terminal glyphs are taller than they are wide. A 2.2:1 character canvas
  // reads as a round globe without consuming the whole prompt vertically.
  const height = Math.ceil(width / 2.2);
  const time = options.seconds ?? 0;
  const phase = (time % 6.4) / 6.4;
  const breath = phase < 0.34 ? 1 - (1 - phase / 0.34) ** 2
    : phase < 0.42 ? 1
      : phase < 0.9 ? (1 + Math.cos(Math.PI * (phase - 0.42) / 0.48)) / 2 : 0;
  const radius = 0.88 + breath * 0.12;

  return Array.from({ length: height }, (_, row) => (
    Array.from({ length: width }, (_, column) => {
      const x = (column + 0.5 - width / 2) / (width / 2 * radius);
      const y = (row + 0.5 - height / 2) / (height / 2 * radius);
      const depthSquared = 1 - x * x - y * y;
      if (depthSquared <= 0) return null;

      const cell = Math.imul(column + 1, 374761393) ^ Math.imul(row + 1, 668265263);
      const seed = Math.imul(cell ^ (cell >>> 13), 1274126177) >>> 0;
      const sweep = Math.floor(time * 2);
      const digit = String((seed + Math.floor((sweep + seed % 19) / 19)) % 10);
      const depth = Math.sqrt(depthSquared);
      const warmEdge = Math.max(0, 1 - Math.hypot(x + 0.2, y + 0.78) * 0.75);
      const light = Math.max(0.62, Math.min(1, 0.66 + depth * 0.18 - y * 0.12 + warmEdge * 0.14 + breath * 0.06));
      const latitude = (y + 1) / 2;
      const rawRgb = latitude < 0.48
        ? [255 - latitude * 120, 194 - latitude * 180, 96 + latitude * 250]
        : [197 - (latitude - 0.48) * 190, 108 + (latitude - 0.48) * 100, 226 + (latitude - 0.48) * 35];
      const rgb = rawRgb.map((channel) => Math.round(channel * light));
      return { digit, light, rgb };
    })
  ));
}
