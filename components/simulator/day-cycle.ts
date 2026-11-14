const peak = (hour: number, center: number, width: number) =>
  Math.exp(-(((hour - center) / width) ** 2));

export function trafficLevel(minute: number, index: number, roadClass: string) {
  const hour = minute / 60;
  return Math.min(
    1,
    0.07 +
      (index % 7) * 0.035 +
      (roadClass === "primary" ? 0.16 : 0) +
      0.58 *
        Math.max(
          peak(hour, 8 + (index % 4) * 0.25, 1.65),
          peak(hour, 17.5, 1.8),
        ),
  );
}

export const demandAnchors = [
  {
    label: "Apartments",
    east: -0.00135,
    north: 0.0013,
    color: "#7ebcff",
    peaks: [7.5, 17.5],
  },
  {
    label: "Offices",
    east: 0.0016,
    north: -0.00055,
    color: "#f6ba69",
    peaks: [8.5, 12],
  },
  {
    label: "Transit",
    east: -0.00055,
    north: -0.0014,
    color: "#70ebc2",
    peaks: [8, 17],
  },
];

export function demandLevel(minute: number, peaks: number[]) {
  return Math.max(...peaks.map((center) => peak(minute / 60, center, 1)));
}

export function daylight(minute: number) {
  // Illustrative mid-November local daylight curve, used to tint the captured mesh.
  const sun = Math.sin((Math.PI * (minute - 410)) / 630);
  return Math.max(0, sun);
}
