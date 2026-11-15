"use client";
import type { CSSProperties, ReactNode } from "react";
import styles from "./landing-demo.module.css";
export const glassBlur: CSSProperties = {
  backdropFilter: "blur(5px) saturate(1.12)",
  WebkitBackdropFilter: "blur(5px) saturate(1.12)",
};
export const dollars = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
export const number = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);
export function Icon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const paths: Record<string, ReactNode> = {
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7Z" />,
    replay: (
      <>
        <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    cup: (
      <>
        <path d="M4 9h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4ZM16 10h2a3 3 0 0 1 0 6h-2M7 3v2M12 3v2" />
      </>
    ),
    food: (
      <>
        <path d="M5 3v7M8 3v7M11 3v7M5 7h6M8 10v11M18 3v18M18 3c-5 4-5 10 0 10" />
      </>
    ),
    salon: (
      <>
        <circle cx="6" cy="17" r="3" />
        <circle cx="17" cy="17" r="3" />
        <path d="m8 15 11-12M15 15 4 3" />
      </>
    ),
    fitness: (
      <>
        <path d="M8 12h8M3 8v8M7 6v12M17 6v12M21 8v8" />
      </>
    ),
    sparkle: (
      <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" />
    ),
    pin: (
      <>
        <path d="M18 10c0 5-6 10-6 10S6 15 6 10a6 6 0 1 1 12 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
  };
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.arrow}
    </svg>
  );
}

export function Glass({
  children,
  className = "",
  style,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      style={{ ...glassBlur, ...style }}
      className={`${styles.glass} ${className}`}
    >
      {children}
    </div>
  );
}

const edgeMap =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><defs><linearGradient id="x"><stop stop-color="#308080"/><stop offset=".12" stop-color="#808080"/><stop offset=".88" stop-color="#808080"/><stop offset="1" stop-color="#d08080"/></linearGradient><linearGradient id="y" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#803080"/><stop offset=".16" stop-color="#808080" stop-opacity="0"/><stop offset=".84" stop-color="#808080" stop-opacity="0"/><stop offset="1" stop-color="#80d080"/></linearGradient></defs><rect width="160" height="100" fill="url(#x)"/><rect width="160" height="100" fill="url(#y)"/></svg>`,
  );
export function Refraction() {
  return (
    <svg className={styles.filter} aria-hidden="true">
      <defs>
        <filter
          id="bizbox-demo-refraction"
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            href={edgeMap}
            x="0"
            y="0"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="edges"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="edges"
            scale="12"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
export function WordHeading({
  text,
  lineTwo,
  as: Tag = "h2",
}: {
  text: string;
  lineTwo?: string;
  as?: "h1" | "h2" | "h3";
}) {
  const first = text.split(" ");
  const words = (line: string, offset: number) =>
    line.split(" ").map((word, i) => (
      <span className={styles.wordClip} key={`${word}-${i}`} aria-hidden="true">
        <span
          style={{ "--word-delay": `${(i + offset) * 120}ms` } as CSSProperties}
        >
          {word}
        </span>{" "}
      </span>
    ));
  return (
    <Tag
      className={styles.revealHeading}
      aria-label={`${text}${lineTwo ? ` ${lineTwo}` : ""}`}
      key={text}
    >
      {words(text, 0)}
      {lineTwo && (
        <>
          <br />
          <span className={styles.headingLineTwo}>
            {words(lineTwo, first.length)}
          </span>
        </>
      )}
    </Tag>
  );
}
