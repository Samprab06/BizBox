import type { Metadata } from "next";
import styles from "./preview.module.css";

export const metadata: Metadata = {
  title: "BizBox — Mobile preview",
  robots: { index: false, follow: false },
};

export default function MobilePreviewPage() {
  return (
    <main className={styles.preview}>
      <header className={styles.header}>
        <h1>Mobile preview</h1>
        <p>
          390 × 844. Scroll inside the phone. Tap Sandbox to test one or two
          counters.
        </p>
        <a href="/landing-demo">Open full page ↗</a>
      </header>
      <div className={styles.phone}>
        <iframe
          src="/landing-demo"
          title="Interactive BizBox mobile landing page"
        />
      </div>
    </main>
  );
}
