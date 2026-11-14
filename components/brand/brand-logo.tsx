import Image from "next/image";

/**
 * The BizBox logo from branding/ (copied to public/brand/). `onDark` picks the white
 * artwork for dark surfaces; the default is the black artwork for light surfaces.
 * The image is decorative and a visually hidden "BizBox" label carries the name, so links
 * that wrap it keep both the accessible name and the text content "BizBox".
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
    <>
      <Image
        src={onDark ? "/brand/logo-on-dark.png" : "/brand/logo-on-light.png"}
        alt=""
        width={116}
        height={32}
        priority={priority}
        className={className ?? "h-8 w-auto"}
      />
      <span className="sr-only">BizBox</span>
    </>
  );
}
