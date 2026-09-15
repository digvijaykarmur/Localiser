"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Library", match: (p: string) => p === "/" || p.startsWith("/t/") || p.startsWith("/j/") },
  { href: "/campaigns", label: "Campaigns", match: (p: string) => p.startsWith("/campaigns") },
  { href: "/metrics", label: "Metrics", match: (p: string) => p.startsWith("/metrics") },
  { href: "/dialects", label: "Dialects", match: (p: string) => p.startsWith("/dialects") },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={`h-12 px-3 inline-flex items-center border-b-2 ${l.match(path) ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
