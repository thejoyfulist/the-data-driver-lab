"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LAB_VIEW_GROUPS, LAB_VIEWS, type LabViewId } from "@/lib/lab-workspace.mjs";
import { readableTeamColor, teamColor } from "@/lib/team-colors";

/**
 * Workspace chrome of the Data Lab: one race selector, the compared
 * drivers, the session status, the grouped view navigation (a side rail on
 * wide screens, scrolling pills on phones) and the phone action bar.
 */

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70";
export const barButton = `inline-flex min-h-11 lg:min-h-10 items-center gap-2 rounded-lg border border-white/[0.10] px-3 text-[13px] text-white/[0.84] transition-colors hover:border-white/[0.22] hover:text-light ${focusRing}`;

/** Disclosure popover: closes on Escape (focus back on the trigger) and on an outside click. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    triggerRef.current?.focus();
  };
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  return { open, setOpen, triggerRef, panelRef, onPanelKeyDown, close };
}

// ── Race selector ───────────────────────────────────────────────────────

export interface PickerRace {
  round: number;
  label: string;
  officialName?: string;
  date: string;
  status: string;
}

interface RacePickerProps {
  season: number;
  seasons: readonly number[];
  liveSeason: number;
  races: readonly PickerRace[];
  round: number | null;
  /** Visible label of the selected race ("R11 · Hungarian Grand Prix"). */
  current: string | null;
  currentOfficialName?: string;
  loading: boolean;
  onSeason: (season: number) => void;
  onRace: (round: number) => void;
}

export function RacePicker({ season, seasons, liveSeason, races, round, current, currentOfficialName, loading, onSeason, onRace }: RacePickerProps) {
  const { open: popoverOpen, setOpen: setPopoverOpen, triggerRef, panelRef, onPanelKeyDown, close: closePopover } = usePopover();
  const panelId = useId();
  useEffect(() => {
    if (!popoverOpen) return;
    panelRef.current?.querySelector<HTMLElement>("[aria-current=true]")?.scrollIntoView({ block: "nearest" });
  }, [popoverOpen, panelRef]);
  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-controls={popoverOpen ? panelId : undefined}
        onClick={() => setPopoverOpen(!popoverOpen)}
        className={`${barButton} max-w-full bg-white/[0.04]`}
        data-race-picker
        title={currentOfficialName}
      >
        <span className="sr-only">Season and race: </span>
        <span className="truncate">
          <span className="font-mono tabular-nums">{season}</span>
          <span className="text-white/[0.62]"> · </span>
          {loading ? "Loading…" : current ?? "No race"}
        </span>
        <span aria-hidden="true" className="text-white/[0.62]">▾</span>
      </button>
      {popoverOpen && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Choose a season and a race"
          onKeyDown={onPanelKeyDown}
          className="absolute left-0 top-full z-50 mt-1.5 w-[min(440px,calc(100vw-32px))] rounded-xl border border-white/[0.12] bg-surface-1 p-3 shadow-glow-depth"
        >
          <label className="flex items-center justify-between gap-3 text-[13px] text-white/[0.78]">
            Season
            <select aria-label="Season" value={season} onChange={(event) => onSeason(Number(event.target.value))} className="control-select max-w-[180px]" autoFocus>
              {seasons.map((year) => <option key={year} value={year}>{year}{year === liveSeason ? " (current)" : ""}</option>)}
            </select>
          </label>
          <ul className="mt-3 max-h-[min(360px,55vh)] space-y-0.5 overflow-y-auto" aria-label={`${season} races`}>
            {races.length === 0 && <li className="px-2 py-3 text-[13px] text-white/[0.70]">{loading ? "Loading the calendar…" : "No race published for this season."}</li>}
            {races.map((race) => (
              <li key={race.round}>
                <button
                  type="button"
                  aria-current={race.round === round ? "true" : undefined}
                  onClick={() => {
                    onRace(race.round);
                    closePopover();
                  }}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-[14px] ${focusRing} ${race.round === round ? "bg-white/[0.08] text-light" : "text-white/[0.80] hover:bg-white/[0.05]"}`}
                  title={race.officialName}
                >
                  <span className="min-w-0 truncate">{race.label}</span>
                  <span className="shrink-0 text-[12px] text-white/[0.66]">{race.date}{race.status !== "completed" ? ` · ${race.status}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Compared drivers ────────────────────────────────────────────────────

export interface PickerDriver {
  id: number;
  code: string;
  name: string;
  team: string;
}

interface DriverChipsProps {
  selected: readonly PickerDriver[];
  available: readonly PickerDriver[];
  max: number;
  onToggle: (id: number) => void;
}

export function DriverChips({ selected, available, max, onToggle }: DriverChipsProps) {
  const { open: popoverOpen, setOpen: setPopoverOpen, triggerRef, panelRef, onPanelKeyDown, close: closePopover } = usePopover();
  const panelId = useId();
  const selectedIds = new Set(selected.map((driver) => driver.id));
  return (
    <div className="relative flex min-w-0 items-center gap-1.5" role="group" aria-label="Compared drivers">
      <ul className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        {selected.map((driver) => (
          <li key={driver.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onToggle(driver.id)}
              aria-label={`Remove ${driver.name} from comparison`}
              title={`${driver.name} · ${driver.team}`}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/[0.12] px-3 lg:min-h-10 text-[13px] hover:border-white/[0.24] ${focusRing}`}
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: teamColor(driver.team) }} />
              <span className="font-mono" style={{ color: readableTeamColor(driver.team) }}>{driver.code}</span>
              <span aria-hidden="true" className="text-white/[0.62]">×</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-controls={popoverOpen ? panelId : undefined}
        onClick={() => setPopoverOpen(!popoverOpen)}
        className={`inline-flex min-h-11 shrink-0 items-center rounded-full border border-dashed lg:min-h-10 border-white/[0.22] px-3 text-[13px] text-white/[0.78] hover:text-light ${focusRing}`}
      >
        + Driver
      </button>
      {popoverOpen && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Add or remove a driver"
          onKeyDown={onPanelKeyDown}
          className="absolute left-0 top-full z-50 mt-1.5 w-[min(320px,calc(100vw-32px))] rounded-xl border border-white/[0.12] bg-surface-1 p-2 shadow-glow-depth"
        >
          <p className="px-2 py-1.5 text-[13px] text-white/[0.70]">Compare up to {max} drivers. Adding a fifth replaces the first.</p>
          <ul className="max-h-[min(360px,55vh)] overflow-y-auto">
            {available.map((driver, index) => (
              <li key={driver.id}>
                <button
                  type="button"
                  aria-pressed={selectedIds.has(driver.id)}
                  onClick={() => onToggle(driver.id)}
                  autoFocus={index === 0}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[14px] ${focusRing} ${selectedIds.has(driver.id) ? "bg-white/[0.08] text-light" : "text-white/[0.80] hover:bg-white/[0.05]"}`}
                >
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: teamColor(driver.team) }} />
                  <span className="w-10 shrink-0 font-mono text-[13px]" style={{ color: readableTeamColor(driver.team) }}>{driver.code}</span>
                  <span className="min-w-0 truncate">{driver.name}</span>
                  {selectedIds.has(driver.id) && <span aria-hidden="true" className="ml-auto text-white/[0.70]">✓</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── View navigation ─────────────────────────────────────────────────────

interface ViewNavProps {
  view: LabViewId;
  hrefFor: (view: LabViewId) => string;
  onSelect: (view: LabViewId) => void;
}

/**
 * One navigation for every width: a grouped side rail from the `lg`
 * breakpoint, a row of scrolling pills below it. Links carry the full view
 * URL, so they open in a new tab and work as deep links.
 */
export function ViewNav({ view, hrefFor, onSelect }: ViewNavProps) {
  const activeRef = useRef<HTMLAnchorElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // Scroll only the pill row; scrollIntoView can also shift the page or leave a clipped pill.
    const list = listRef.current;
    const active = activeRef.current;
    if (!list || !active || window.matchMedia("(min-width: 1024px)").matches) return;
    const left = active.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
    list.scrollLeft = Math.max(0, left);
  }, [view]);
  function onClick(event: MouseEvent<HTMLAnchorElement>, id: LabViewId) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onSelect(id);
  }
  return (
    <nav aria-label="Lab views" className="min-w-0">
      <ul ref={listRef} className="flex gap-1 overflow-x-auto px-4 py-1.5 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:py-0">
        {LAB_VIEW_GROUPS.map((group) => (
          <li key={group} className="contents lg:block">
            <p className="hidden px-3 pb-1 pt-4 text-[12px] font-medium text-white/[0.62] lg:block">{group}</p>
            <ul className="contents lg:block">
              {LAB_VIEWS.filter((item) => item.group === group).map((item) => {
                const active = item.id === view;
                return (
                  <li key={item.id} className="shrink-0">
                    <a
                      ref={active ? activeRef : undefined}
                      href={hrefFor(item.id)}
                      aria-current={active ? "page" : undefined}
                      onClick={(event) => onClick(event, item.id)}
                      className={`flex min-h-11 items-center whitespace-nowrap rounded-full border px-3.5 text-[14px] lg:min-h-9 lg:rounded-lg lg:px-3 ${focusRing} ${active ? "border-white/[0.14] bg-white/[0.08] text-light" : "border-white/[0.08] text-white/[0.72] hover:bg-white/[0.04] hover:text-light lg:border-transparent"}`}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ── Phone action bar ────────────────────────────────────────────────────

interface MobileActionBarProps {
  onAsk: () => void;
  menu: readonly { label: string; run: () => void; pressed?: boolean }[];
  status?: ReactNode;
}

/** Bottom bar on phones: "Ask the data" and a ⋯ sheet (share, API and export, search). */
const subscribeNothing = () => () => {};

export function MobileActionBar(props: MobileActionBarProps) {
  // The page template animates with a transform, which would pin a fixed
  // bar to the page instead of the screen: render it at the end of <body>.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return mounted ? createPortal(<MobileActionBarContent {...props} />, document.body) : null;
}

function MobileActionBarContent({ onAsk, menu, status }: MobileActionBarProps) {
  const { open: popoverOpen, setOpen: setPopoverOpen, triggerRef, panelRef, onPanelKeyDown, close: closePopover } = usePopover();
  const panelId = useId();
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-dark/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur lg:hidden" data-mobile-actions>
      {popoverOpen && (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label="Share and export"
          onKeyDown={onPanelKeyDown}
          className="mb-3 rounded-xl border border-white/[0.12] bg-surface-1 p-1"
        >
          {menu.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              autoFocus={index === 0}
              onClick={() => {
                item.run();
                closePopover();
              }}
              className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[15px] text-white/[0.86] hover:bg-white/[0.06] ${focusRing}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onAsk} className={`flex min-h-11 flex-1 items-center justify-center rounded-lg bg-light text-[15px] font-medium text-dark ${focusRing}`}>
          Ask the data
        </button>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Share and export"
          aria-haspopup="menu"
          aria-expanded={popoverOpen}
          aria-controls={popoverOpen ? panelId : undefined}
          onClick={() => setPopoverOpen(!popoverOpen)}
          className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/[0.14] text-[18px] text-light ${focusRing}`}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </div>
      {status}
    </div>
  );
}
