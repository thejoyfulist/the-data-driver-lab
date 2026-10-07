import Link from "next/link";
import { API_DOCS_URL, REPO_URL, SITE_URL } from "@/lib/site";

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path d="M4 4 L20 16 L4 28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 8 L24 16 L10 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      <path d="M16 12 L26 16 L16 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" />
      <circle cx="26" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}

const links = [
  { label: "API docs", href: API_DOCS_URL, className: "" },
  { label: "Website", href: SITE_URL, className: "hidden sm:inline" },
  { label: "Source", href: REPO_URL, className: "" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-50 h-14 border-b border-white/[0.04] bg-dark/60 backdrop-blur-[24px]">
      <div className="mx-auto flex h-full max-w-[1480px] items-center justify-between px-4 md:px-8">
        <Link href="/" aria-label="Data Lab home" className="group flex items-center gap-2.5">
          <LogoMark className="h-5 w-5 text-teal transition-transform duration-medium ease-snappy group-hover:translate-x-0.5" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/[0.60]">
            <span className="hidden sm:inline">The Data Driver <span className="text-white/[0.40]">/</span> </span>
            <span className="text-light">Data Lab</span>
          </span>
        </Link>
        <nav aria-label="External links" className="flex items-center gap-4 md:gap-6">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              rel="noopener noreferrer"
              className={`${link.className} font-mono text-[11px] uppercase tracking-[0.12em] text-white/[0.62] transition-colors duration-fast hover:text-light`}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
