"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** The immersive workspace has its own single header; other project pages retain their shell. */
export function ProjectFrame({ children }: { children: ReactNode }) {
  const workspace = usePathname().endsWith("/workspace");
  return (
    <div className={workspace ? "min-h-dvh bg-[#0c1019]" : undefined}>
      {!workspace && (
        <header className="border-b border-line bg-white">
          <div className="mx-auto max-w-5xl px-5 py-5 sm:px-8">
            <Link
              href="/projects/houston-coffee/intake"
              className="text-xl font-bold tracking-tight text-pine"
            >
              BizBox
            </Link>
          </div>
        </header>
      )}
      <main
        className={workspace ? "w-full" : "mx-auto max-w-5xl px-5 py-7 sm:px-8"}
      >
        {children}
      </main>
    </div>
  );
}
