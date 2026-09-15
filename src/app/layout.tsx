import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";
import { NavLinks } from "@/components/NavLinks";

export const metadata: Metadata = {
  title: "STAGE Promo Engine",
  description: "Source-grounded promo production and campaign tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <header className="h-12 border-b border-hairline flex items-center px-4 gap-6 shrink-0">
              <Link href="/" className="font-semibold tracking-tight text-ink">
                STAGE <span className="text-muted font-normal">Promo Engine</span>
              </Link>
              <NavLinks />
            </header>
            <main className="flex-1 px-4 py-4 max-w-[1600px] w-full mx-auto">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
