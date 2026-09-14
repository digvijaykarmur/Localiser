"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Library" },
  { href: "/metrics", label: "Metrics" },
  { href: "/dialects", label: "Dialects" },
];

export function Shell({
  children,
  status,
}: {
  children: React.ReactNode;
  status?: React.ReactNode;
}) {
  const path = usePathname();
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">STAGE Promo</div>
        <nav className="nav">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div style={{ marginLeft: "auto" }}>{status}</div>
      </header>
      <div className="main">{children}</div>
    </div>
  );
}
