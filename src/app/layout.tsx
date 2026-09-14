import type { Metadata } from "next";
import { Inter, Noto_Sans_Bengali, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { ProviderStatus } from "@/components/ProviderStatus";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const notoDeva = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["600", "700"], variable: "--font-deva" });
const notoBeng = Noto_Sans_Bengali({ subsets: ["bengali"], weight: ["600", "700"], variable: "--font-beng" });

export const metadata: Metadata = {
  title: "STAGE Promo Engine",
  description: "Evidence-grounded promotional video production",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${notoDeva.variable} ${notoBeng.variable}`}>
        <Shell status={<ProviderStatus />}>{children}</Shell>
      </body>
    </html>
  );
}
