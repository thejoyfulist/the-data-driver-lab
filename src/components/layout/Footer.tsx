import { API_DOCS_URL, REPO_URL, SITE_URL } from "@/lib/site";

export function Footer() {
  return (
    <footer className="mt-20 border-t border-white/[0.04]">
      <div className="mx-auto grid max-w-[1480px] gap-8 px-4 py-12 md:grid-cols-[1.4fr_1fr] md:px-8">
        <div className="max-w-xl space-y-3">
          <p className="font-serif text-h3 leading-snug text-light">Open-source Formula 1 data, read from a public API.</p>
          <p className="text-body-sm leading-relaxed text-white/[0.60]">
            Official results, qualifying and standings come from formula1.com. Lap, stint, weather, race control and telemetry
            enrichment comes from{" "}
            <a href="https://openf1.org" rel="noopener noreferrer" className="text-light underline underline-offset-2">OpenF1</a>{" "}
            under{" "}
            <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" rel="noopener noreferrer" className="text-light underline underline-offset-2">CC BY-NC-SA 4.0</a>{" "}
            (non-commercial, attribution, share-alike).
          </p>
          <p className="text-body-sm leading-relaxed text-white/[0.60]">
            This project is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1,
            FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.
          </p>
        </div>
        <ul className="space-y-2 md:justify-self-end">
          {[
            { label: "thedatadriver.app", href: SITE_URL },
            { label: "API documentation", href: API_DOCS_URL },
            { label: "Source code (MIT)", href: REPO_URL },
          ].map((link) => (
            <li key={link.label}>
              <a href={link.href} rel="noopener noreferrer" className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/[0.62] hover:text-light">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
