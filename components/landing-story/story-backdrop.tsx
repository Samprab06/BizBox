import { STORY_ASSETS } from "./asset-paths";
import styles from "./story-backdrop.module.css";

type Props = {
  variant: "world" | "stage";
  priority?: boolean;
  dimmed?: boolean;
  className?: string;
  sizes?: string;
  fetchPriority?: "high" | "low" | "auto";
};

/** Native picture exposes the right WebP candidate in SSR, without optimizer work
 * or a separate full-size preload that could compete with the responsive source. */
export function StoryBackdrop({
  variant,
  priority = variant === "world",
  dimmed = false,
  className = "",
  sizes,
  fetchPriority,
}: Props) {
  const asset = variant === "world" ? STORY_ASSETS.hero : STORY_ASSETS.stage;
  return (
    <div
      className={`${styles.backdrop} ${styles[variant]} ${dimmed ? styles.dimmed : ""} ${className}`}
      aria-hidden="true"
      data-story-backdrop={variant}
    >
      <picture>
        <source
          type="image/webp"
          srcSet={asset.imageSrcSet}
          sizes={sizes ?? asset.sizes}
        />
        {/* Build-time WebP and native picture intentionally bypass next/image's
            runtime optimizer and its independently selected preload. */}
        <img
          src={asset.src}
          width={asset.width}
          height={asset.height}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={fetchPriority ?? (priority ? "high" : "low")}
          decoding="async"
        />
      </picture>
    </div>
  );
}
