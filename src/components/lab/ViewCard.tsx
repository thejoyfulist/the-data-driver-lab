"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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

/**
 * "</> API" in the workspace bar reveals, in every view on screen, the
 * requests behind it and its exports. Off by default: the mechanics stay one
 * click away instead of on every card.
 */
export const ApiPanelContext = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });

export interface ViewCardProps {
  /** Element id of the view (deep links, focus, end-to-end tests). */
  id: string;
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
  /** "view": the workspace's single full-width view (h1). "card": a race report card (h2). */
  variant?: "view" | "card";
  children: ReactNode;
}

const quietButton =
  "inline-flex min-h-11 lg:min-h-9 items-center gap-1.5 rounded-md border border-white/[0.10] px-3 text-[13px] text-white/[0.78] transition-colors duration-fast hover:border-white/[0.22] hover:text-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 disabled:cursor-not-allowed disabled:opacity-50";

export function ViewCard({
  id,
  title,
  scope,
  endpoints,
  source,
  exportRows,
  exportName,
  table,
  actions,
  footnote,
  variant = "view",
  children,
}: ViewCardProps) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<"chart" | "table">("chart");
  const { open: apiOpen } = useContext(ApiPanelContext);

  // A browser-loaded view replaces its placeholder: if the view navigation
  // focused the placeholder heading, move focus to the real one.
  useEffect(() => {
    const holder = sectionRef.current?.closest<HTMLElement>("[data-focus-pending]");
    if (!holder) return;
    holder.removeAttribute("data-focus-pending");
    const heading = sectionRef.current?.querySelector<HTMLElement>("h1, h2");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }, []);

  const card = variant === "card";
  const Heading = card ? "h2" : "h1";

  return (
    <section
      ref={sectionRef}
      id={id}
      aria-labelledby={headingId}
      className={`min-w-0 scroll-mt-32 ${card ? "flex flex-col rounded-xl border border-white/[0.08] bg-white/[0.018] p-4 md:p-5" : ""}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl flex-1">
          <Heading id={headingId} className={card ? "font-serif text-[19px] leading-6 text-light" : "font-serif text-[26px] leading-8 tracking-[-0.02em] text-light md:text-[30px] md:leading-9"}>
            {title}
          </Heading>
          <p className={`mt-1 ${card ? "text-[13px]" : "text-[14px]"} leading-5 text-white/[0.70]`} data-view-scope>
            {scope}
          </p>
        </div>
        <div className="flex max-w-[55%] shrink-0 flex-wrap items-center justify-end gap-1.5" role="group" aria-label={`${title} actions`}>
          {actions}
          {table && (
            <div className="flex rounded-md border border-white/[0.10] p-0.5" role="group" aria-label="Display">
              {(["chart", "table"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                  className={`min-h-10 rounded px-3 text-[13px] capitalize lg:min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 ${mode === value ? "bg-teal text-dark" : "text-white/[0.72] hover:text-light"}`}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
          <ViewMenu title={title} endpoints={endpoints} exportRows={exportRows} exportName={exportName} />
        </div>
      </header>
      {apiOpen && <ApiPanel title={title} endpoints={endpoints} exportRows={exportRows} exportName={exportName} />}
      <div className={card ? "mt-4 flex-1" : "mt-5 rounded-xl border border-white/[0.08] bg-white/[0.018] p-4 md:p-5"}>
        {mode === "table" && table ? table : children}
      </div>
      <SourceLine source={source} footnote={footnote} />
    </section>
  );
}

/** Source, licence and fetch time of a view, on one discreet line. */
export function SourceLine({ source, footnote }: { source?: LabSourceMeta | null; footnote?: ReactNode }) {
  const fetchedAt = formatUtcTimestamp(source?.data_fetched_at ?? source?.timestamp ?? null);
  return (
    <footer className="mt-3 space-y-1 text-[12px] leading-5 text-white/[0.62]" data-view-source>
      <p>
        Source · {describeSource(source)}
        {source?.license_url && source.source?.startsWith("openf1.org") ? (
          <>
            {" · "}
            <a href={source.license_url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-light">licence</a>
          </>
        ) : null}
        {" · "}
        {fetchedAt ? `fetched ${fetchedAt}` : "fetch time not published"}
        {source?.adaptation_notice ? ` · ${source.adaptation_notice}` : null}
      </p>
      {footnote && <p className="max-w-4xl text-white/[0.66]">{footnote}</p>}
    </footer>
  );
}

export interface ExportProps {
  title: string;
  endpoints: readonly string[];
  exportRows: readonly ExportRow[];
  exportName: string;
}

function requestLines(endpoints: readonly string[]): string {
  const visible = endpoints.slice(0, 3).map((endpoint) => `GET ${publicApiUrl(endpoint)}`);
  return endpoints.length > 3 ? [...visible, `+ ${endpoints.length - 3} more requests (copied in full)`].join("\n") : visible.join("\n");
}

function useExport({ endpoints, exportRows, exportName }: ExportProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  return {
    copyState,
    hasRows: exportRows.length > 0,
    csv: () => downloadText(`${exportName}.csv`, toCsv(exportRows), "text/csv"),
    json: () => downloadText(`${exportName}.json`, `${JSON.stringify(exportRows, null, 2)}\n`, "application/json"),
    copy: async () => {
      const copied = await copyText(endpoints.map(publicApiUrl).join("\n"));
      setCopyState(copied ? "copied" : "failed");
      window.setTimeout(() => setCopyState("idle"), 2_000);
    },
  };
}

/** Requests behind the view and its exports, shown while "</> API" is on. */
export function ApiPanel(props: ExportProps) {
  const { title, endpoints } = props;
  const actions = useExport(props);
  return (
    <div className="mt-3 rounded-lg border border-white/[0.08] bg-black/30 p-3" data-api-panel>
      {endpoints.length > 0 ? (
        <pre className="overflow-x-auto whitespace-pre font-mono text-[12px] leading-5 text-white/[0.78]" tabIndex={0} aria-label="API request">
          {requestLines(endpoints)}
        </pre>
      ) : (
        <p className="text-[13px] text-white/[0.66]">This view makes no API request for the current selection.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={quietButton} disabled={endpoints.length === 0} aria-label={`Copy API request for ${title}`} onClick={() => void actions.copy()}>
          {actions.copyState === "copied" ? "Copied" : actions.copyState === "failed" ? "Copy failed" : "Copy request"}
        </button>
        <button type="button" className={quietButton} disabled={!actions.hasRows} aria-label={`Export ${title} as CSV`} onClick={actions.csv}>CSV</button>
        <button type="button" className={quietButton} disabled={!actions.hasRows} aria-label={`Export ${title} as JSON`} onClick={actions.json}>JSON</button>
        <span className="sr-only" aria-live="polite">{actions.copyState === "copied" ? "API request copied to clipboard" : actions.copyState === "failed" ? "Copy failed" : ""}</span>
      </div>
    </div>
  );
}

/** "⋯" menu: CSV / JSON export, "Copy API request" and the API panel toggle. */
export function ViewMenu(props: ExportProps) {
  const { title, endpoints } = props;
  const actions = useExport(props);
  const api = useContext(ApiPanelContext);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function run(action: () => void | Promise<void>, enabled: boolean) {
    if (!enabled) return;
    setOpen(false);
    buttonRef.current?.focus();
    void action();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? items[0] : items.at(-1))?.focus();
    }
  }

  const items: { label: string; enabled: boolean; action: () => void | Promise<void> }[] = [
    { label: "Download CSV", enabled: actions.hasRows, action: actions.csv },
    { label: "Download JSON", enabled: actions.hasRows, action: actions.json },
    { label: actions.copyState === "copied" ? "Request copied" : "Copy API request", enabled: endpoints.length > 0, action: actions.copy },
    { label: api.open ? "Hide API requests" : "Show API requests", enabled: true, action: () => api.setOpen(!api.open) },
  ];

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`More actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`${quietButton} min-w-11 justify-center px-2 lg:min-w-9`}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`${title} actions`}
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-white/[0.12] bg-surface-2 p-1 shadow-glow-depth"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={!item.enabled}
              onClick={() => run(item.action, item.enabled)}
              className={`flex min-h-10 w-full items-center rounded-md px-3 text-left text-[14px] focus-visible:outline-none ${item.enabled ? "text-white/[0.84] hover:bg-white/[0.06] focus:bg-white/[0.08]" : "cursor-not-allowed text-white/[0.62]"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <span className="sr-only" aria-live="polite">{actions.copyState === "copied" ? "API request copied to clipboard" : actions.copyState === "failed" ? "Copy failed" : ""}</span>
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

/** Compact, sourced empty state: one line and the API's reason, never a bare dash or a large empty card. */
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
    <p className="text-[14px] leading-6" data-empty-state>
      <span aria-hidden="true" className={`mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full align-middle ${tone === "amber" ? "bg-ambre" : "bg-white/40"}`} />
      <span className={tone === "amber" ? "text-ambre" : "text-white/[0.86]"}>{title}.</span>{" "}
      <span className="text-white/[0.70]">{detail}</span>
      {source && <span className="ml-2 font-mono text-[12px] text-white/[0.62]">Checked: {source}</span>}
    </p>
  );
}
