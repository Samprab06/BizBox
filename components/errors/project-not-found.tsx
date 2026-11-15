"use client";

import { usePathname } from "next/navigation";
import { NotFoundPage } from "./not-found-page";
import { projectMapFromPath } from "./project-recovery";

export function ProjectNotFound() {
  return <NotFoundPage mapHref={projectMapFromPath(usePathname())} />;
}
