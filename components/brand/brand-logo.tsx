import Image from "next/image";

/**
 * The BizBox logo from branding/ (copied to public/brand/). `onDark` picks the white
 * artwork for dark surfaces; the default is the black artwork for light surfaces.
 * The alt text keeps links that wrap it named "BizBox".
 */
export function BrandLogo({
  onDark = false,
  className,
  priority = false,
}: {
  onDark?: boolean;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={onDark ? "/brand/logo-on-dark.png" : "/brand/logo-on-light.png"}
      alt="BizBox"
      width={1791}
      height={494}
      priority={priority}
      className={className ?? "h-8 w-auto"}
    />
  );
}
