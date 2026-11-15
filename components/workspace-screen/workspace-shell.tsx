"use client";

import Image from "next/image";
import { useId, type ReactNode } from "react";
import { cityPhotoFor, type WorkspaceHeader } from "./model";
import styles from "./workspace-glass.module.css";

/** Presentation only: visualization and the existing assistant retain their own controllers. */
export function WorkspaceShell({
  header,
  navigation,
  backdrop,
  children,
  assistant,
}: {
  header: WorkspaceHeader;
  /** Kept for callers; the project layout's top bar is the only navigation. */
  projectId?: string;
  selectedSiteId?: string;
  navigation?: ReactNode;
  backdrop?: ReactNode;
  children: ReactNode;
  /** Optional: inside the consultant shell the assistant is the dock, not a column here. */
  assistant?: ReactNode;
  /** `null` hides "Edit brief"; omitted links to the intake for the selected site. */
  editBriefHref?: string | null;
}) {
  const headingId = useId();
  const photo = cityPhotoFor(header.city);

  return (
    <section
      aria-labelledby={headingId}
      className={styles.shell}
      data-surface="viewport"
      data-workspace-mode={backdrop ? "locations" : "report"}
    >
      <div className={styles.atmosphere} aria-hidden="true">
        {photo && (
          <Image
            src={photo.src}
            alt=""
            fill
            sizes="100vw"
            priority
            className={styles.photo}
          />
        )}
      </div>
      <div className={styles.shade} aria-hidden="true" />
      <h1 id={headingId} className="sr-only">
        Workspace
      </h1>
      {navigation && <div className={styles.credits}>{navigation}</div>}
      <div
        className={
          assistant
            ? styles.workspace
            : `${styles.workspace} ${styles.workspaceSolo}`
        }
      >
        {backdrop && <div className={styles.backdrop}>{backdrop}</div>}
        <div className={styles.visualization}>{children}</div>
        {assistant && <div className={styles.assistantSlot}>{assistant}</div>}
      </div>
    </section>
  );
}
