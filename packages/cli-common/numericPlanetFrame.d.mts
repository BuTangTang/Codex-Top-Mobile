export type NumericPlanetCell = Readonly<{
  digit: string;
  light: number;
  rgb: readonly [number, number, number];
}>;

export type NumericPlanetFrame = readonly (readonly (NumericPlanetCell | null)[])[];

export function createNumericPlanetFrame(options?: Readonly<{
  columns?: number;
  seconds?: number;
}>): NumericPlanetFrame;
