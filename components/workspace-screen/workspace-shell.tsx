"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { workspaceHref } from "@/lib/client/workspace-routes";
import type { WorkspaceHeader } from "./model";
import styles from "./workspace-glass.module.css";

/** Presentation only: visualization and the existing assistant retain their own controllers. */
export function WorkspaceShell({
  header,
  projectId,
  selectedSiteId,
  navigation,
  backdrop,
  children,
  assistant,
}: {
  header: WorkspaceHeader;
  projectId: string;
  selectedSiteId?: string;
  navigation?: ReactNode;
  backdrop?: ReactNode;
  children: ReactNode;
  assistant: ReactNode;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={styles.shell}
      data-surface="viewport"
    >
      <h1 id={headingId} className="sr-only">
        Workspace
      </h1>
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              b
            </span>
            BizBox
          </span>
          <div className={styles.project}>
            <span>{header.business}</span>
            <span className={styles.projectDivider} aria-hidden="true">
              /
            </span>
            <span className={styles.muted}>{header.city}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.budget}>
            {header.budget}
            {header.budgetIsDefault && (
              <span className={styles.budgetOrigin}>Default</span>
            )}
          </span>
          {navigation && <div className={styles.navigation}>{navigation}</div>}
          <Link
            href={workspaceHref(projectId, "intake", selectedSiteId)}
            prefetch={false}
            className={styles.editBrief}
          >
            Edit brief
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m12 4 4 4M3 17l4-1L17 6l-3-3L4 13l-1 4Z" />
            </svg>
          </Link>
        </div>
      </header>
      <div className={styles.workspace}>
        {backdrop && <div className={styles.backdrop}>{backdrop}</div>}
        <div className={styles.visualization}>{children}</div>
        <div className={styles.assistantSlot}>{assistant}</div>
      </div>
    </section>
  );
}
