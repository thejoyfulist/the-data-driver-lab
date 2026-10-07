"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { API_DOCS_URL } from "@/lib/site";
import { ViewSkeleton } from "./ViewCard";

/**
 * Shell shown in place of a view that loads in the browser: while its code
 * or data downloads, and on the no-JavaScript page (where the skeleton is
 * hidden and a note explains it). It keeps the view's anchor id and title.
 */
export function ViewPlaceholder({ id, title, variant = "view" }: { id: string; title: string; variant?: "view" | "card" }) {
  const card = variant === "card";
  return (
    <section
      id={id}
      aria-label={title}
      data-view-placeholder
      className={`min-w-0 scroll-mt-32 ${card ? "rounded-xl border border-white/[0.08] bg-white/[0.018] p-4 md:p-5" : ""}`}
    >
      {card ? (
        <h2 className="font-serif text-[19px] leading-6 text-light">{title}</h2>
      ) : (
        <h1 className="font-serif text-[26px] leading-8 tracking-[-0.02em] text-light md:text-[30px] md:leading-9">{title}</h1>
      )}
      <div className={card ? "mt-4" : "mt-5 rounded-xl border border-white/[0.08] bg-white/[0.018] p-4 md:p-5"}>
        <ViewSkeleton label={`Loading ${title}`} rows={6} />
        <noscript>
          <p className="text-[14px] leading-relaxed text-white/[0.70]">
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
