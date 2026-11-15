import styles from "./brand.module.css";

/** Existing BizBox mark, rendered in the current surface's ink color. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={styles.brand} aria-label="BizBox">
      <span className={styles.mark} aria-hidden="true" />
      {!compact && (
        <span className={styles.wordmark}>
          BizBox<span className={styles.dot}>.</span>
        </span>
      )}
    </span>
  );
}
