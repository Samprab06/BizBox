import { daylight } from "./day-cycle";

const clouds = [
  { left: 3, top: 5, width: 26 },
  { left: 28, top: 2, width: 22 },
  { left: 53, top: 10, width: 32 },
  { left: 79, top: 3, width: 24 },
];

export function NeighborhoodSky({ minute }: { minute: number }) {
  const light = daylight(minute);
  const twilight = Math.max(
    0,
    1 - Math.min(Math.abs(minute - 410), Math.abs(minute - 1040)) / 80,
  );
  const progress = (minute - 410) / 630;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-[#10182e]"
    >
      <div
        className="absolute inset-0 bg-gradient-to-b from-[#3f91cb] via-[#91c6e8] to-[#e4eff7]"
        style={{ opacity: Math.min(1, light * 2.5) }}
      />
      <div
        className="absolute inset-0 bg-gradient-to-b from-transparent via-[#e99079] to-[#ffd4a3]"
        style={{ opacity: twilight * 0.8 }}
      />
      {progress >= 0 && progress <= 1 && (
        <div
          className="absolute size-9 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#fff3ce] shadow-[0_0_40px_17px_#ffe3a4aa]"
          style={{ left: `${9 + 82 * progress}%`, top: `${27 - 22 * light}%` }}
        />
      )}
      {clouds.map(({ left, top, width }) => (
        <div
          key={left}
          className="absolute h-[7vh] blur-[2px]"
          style={{
            left: `${left + (minute / 1440) * 7}%`,
            top: `${top}%`,
            width: `${width}%`,
            opacity: 0.1 + 0.66 * Math.max(light, twilight * 0.65),
            background:
              "radial-gradient(ellipse at 29% 66%, white 4%, transparent 48%), radial-gradient(ellipse at 49% 43%, white 8%, transparent 47%), radial-gradient(ellipse at 68% 63%, white 4%, transparent 44%)",
          }}
        />
      ))}
    </div>
  );
}
