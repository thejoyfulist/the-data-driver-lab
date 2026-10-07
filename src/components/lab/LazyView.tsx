"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { API_DOCS_URL } from "@/lib/site";
import { ViewSkeleton } from "./ViewCard";

/**
 * Card shell shown in place of a view that loads in the browser: before it
 * scrolls near the viewport, while its code downloads, and on the
 * no-JavaScript page (where the skeleton is hidden and a note explains it).
 * It keeps the view's anchor id, so the view navigation and ⌘K still land.
 */
export function ViewPlaceholder({ id, index, title }: { id: string; index: string; title: string }) {
  return (
    <section
      id={id}
      aria-label={title}
      data-view-placeholder
      className="min-w-0 scroll-mt-28 rounded-xl border border-white/[0.08] bg-white/[0.018]"
    >
      <header className="border-b border-white/[0.06] px-4 py-4 md:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/[0.62]">{index}</p>
        <h2 className="mt-1 font-serif text-h3 text-light">{title}</h2>
      </header>
      <div className="px-4 py-5 md:px-6">
        <ViewSkeleton label={`Loading ${title}`} rows={6} />
        <noscript>
          <p className="text-body-sm leading-relaxed text-white/[0.66]">
            This view is drawn in the browser. Without JavaScript, the same data is published by the public API: see the{" "}
            <a href={API_DOCS_URL} className="text-light underline underline-offset-2">API documentation</a>.
          </p>
        </noscript>
      </div>
    </section>
  );
}

/**
 * Mount `children` only when the view comes within ~one screen of the
 * viewport (a URL hash scrolls it there). Until then `placeholder` is shown,
 * so a season-wide view costs no request and no code for a visitor who never
 * scrolls to it.
 */
export function LazyView({ id, placeholder, children }: { id: string; placeholder: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      // Very old browsers: load right away rather than never.
      const timer = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-lazy-view={id} className="grid min-w-0">
      {visible ? children : placeholder}
    </div>
  );
}
