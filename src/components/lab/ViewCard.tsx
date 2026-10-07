"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  copyText,
  describeSource,
  downloadText,
  formatUtcTimestamp,
  publicApiUrl,
  toCsv,
  type ExportRow,
  type LabSourceMeta,
} from "@/lib/lab-client";

export interface ViewCardProps {
  /** Anchor id, used by the view navigation and the command palette. */
  id: string;
  index: string;
  title: string;
  /** One line stating exactly what is shown: season, round, filter and row count. */
  scope: string;
  /** API paths behind the view (without origin), in the order they are read. */
  endpoints: readonly string[];
  source?: LabSourceMeta | null;
  exportRows: readonly ExportRow[];
  exportName: string;
  /** Optional table rendering of the same rows (Chart / Table toggle). */
  table?: ReactNode;
  actions?: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
}

const toolbarButton =
  "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-white/[0.10] px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-white/[0.72] transition-colors duration-fast hover:border-white/[0.22] hover:text-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 disabled:cursor-not-allowed disabled:opacity-40";

export function ViewCard({
  id,
  index,
  title,
  scope,
  endpoints,
  source,
  exportRows,
  exportName,
  table,
  actions,
  footnote,
  children,
}: ViewCardProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<"chart" | "table">("chart");

  // A browser-loaded view replaces its placeholder: if ⌘K or the view
  // navigation focused the placeholder heading, move focus to the real one.
  useEffect(() => {
    const holder = sectionRef.current?.closest<HTMLElement>("[data-focus-pending]");
    if (!holder) return;
    holder.removeAttribute("data-focus-pending");
    const heading = sectionRef.current?.querySelector<HTMLElement>("h2");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }, []);
  const visibleRequests = endpoints.slice(0, 3).map((endpoint) => `GET ${publicApiUrl(endpoint)}`);
  const requestText = endpoints.length > 3
    ? [...visibleRequests, `+ ${endpoints.length - 3} more requests (copied in full)`].join("\n")
    : visibleRequests.join("\n");
  const fetchedAt = formatUtcTimestamp(source?.data_fetched_at ?? source?.timestamp ?? null);

  return (
    <section
      ref={sectionRef}
      id={id}
      aria-labelledby={headingId}
      className="min-w-0 scroll-mt-28 rounded-xl border border-white/[0.08] bg-white/[0.018]"
    >
      <header className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/[0.62]">{index}</p>
            <h2 id={headingId} className="mt-1 font-serif text-h3 text-light">{title}</h2>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-white/[0.66]" data-view-scope>
              {scope}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${title} actions`}>
            {actions}
            {table && (
              <div className="flex rounded-md border border-white/[0.10] p-0.5" role="group" aria-label="Display">
                {(["chart", "table"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                    className={`min-h-8 rounded px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 ${mode === value ? "bg-white/[0.10] text-light" : "text-white/[0.66] hover:text-light"}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
            <ViewActions title={title} endpoints={endpoints} exportRows={exportRows} exportName={exportName} bare />
          </div>
        </div>
        {endpoints.length > 0 && (
          <pre className="overflow-x-auto whitespace-pre rounded-md border border-white/[0.06] bg-black/30 px-3 py-2 font-mono text-[11px] leading-5 text-white/[0.70]" tabIndex={0} aria-label="API request">
            {requestText}
          </pre>
        )}
      </header>
      <div className="px-4 py-5 md:px-6">{mode === "table" && table ? table : children}</div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.06em] text-white/[0.62] md:px-6">
        <span>
          Source · {describeSource(source)}
          {source?.license_url && source.source?.startsWith("openf1.org") ? (
            <>
              {" · "}
              <a href={source.license_url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-light">
                licence
              </a>
            </>
          ) : null}
        </span>
        <span>{fetchedAt ? `Fetched ${fetchedAt}` : "Fetch time not published"}</span>
        {footnote && <span className="w-full normal-case tracking-normal text-caption text-white/[0.62]">{footnote}</span>}
      </footer>
    </section>
  );
}

interface ViewActionsProps {
  title: string;
  endpoints: readonly string[];
  exportRows: readonly ExportRow[];
  exportName: string;
  /** Render the buttons only (inside an existing action group). */
  bare?: boolean;
}

/** CSV / JSON export and "Copy API request" for any Lab view. */
export function ViewActions({ title, endpoints, exportRows, exportName, bare = false }: ViewActionsProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const hasRows = exportRows.length > 0;

  async function copyRequest() {
    const copied = await copyText(endpoints.map(publicApiUrl).join("\n"));
    setCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 2_000);
  }

  const buttons = (
    <>
      <button
        type="button"
        className={toolbarButton}
        disabled={!hasRows}
        aria-label={`Export ${title} as CSV`}
        onClick={() => downloadText(`${exportName}.csv`, toCsv(exportRows), "text/csv")}
      >
        CSV
      </button>
      <button
        type="button"
        className={toolbarButton}
        disabled={!hasRows}
        aria-label={`Export ${title} as JSON`}
        onClick={() => downloadText(`${exportName}.json`, `${JSON.stringify(exportRows, null, 2)}\n`, "application/json")}
      >
        JSON
      </button>
      <button
        type="button"
        className={toolbarButton}
        disabled={endpoints.length === 0}
        aria-label={`Copy API request for ${title}`}
        onClick={() => void copyRequest()}
      >
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy API request"}
      </button>
      <span className="sr-only" aria-live="polite">
        {copyState === "copied" ? "API request copied to clipboard" : copyState === "failed" ? "Copy failed" : ""}
      </span>
    </>
  );
  if (bare) return buttons;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${title} actions`}>
      {buttons}
    </div>
  );
}

export function ViewSkeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2.5" data-skeleton>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3" aria-hidden="true">
          <span className="h-3 w-10 animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" />
          <span
            className="h-6 animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none"
            style={{ width: `${88 - index * (60 / Math.max(rows, 1))}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/** Explicit, sourced empty state: never a bare dash. */
export function NotPublished({
  title = "Not published for this session",
  detail,
  source,
  tone = "neutral",
}: {
  title?: string;
  detail: string;
  source?: string | null;
  tone?: "neutral" | "amber";
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-5 ${tone === "amber" ? "border-ambre/30 bg-ambre/[0.05]" : "border-white/[0.08] bg-white/[0.02]"}`}
      data-empty-state
    >
      <p className={`font-mono text-[11px] uppercase tracking-[0.1em] ${tone === "amber" ? "text-ambre" : "text-white/[0.80]"}`}>{title}</p>
      <p className="mt-2 max-w-2xl text-body-sm leading-relaxed text-white/[0.66]">{detail}</p>
      {source && <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-white/[0.62]">Checked source · {source}</p>}
    </div>
  );
}
