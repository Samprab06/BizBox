import type { Metadata } from "next";
import { ProjectNotFound } from "@/components/errors/project-not-found";

export const metadata: Metadata = { title: "Page not found | BizBox" };

/** Above the project layout: a saved consultant focus preference cannot hide recovery. */
export default function NotFound() {
  return <ProjectNotFound />;
}
