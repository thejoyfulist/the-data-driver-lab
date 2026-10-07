import type { Metadata, Viewport } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "Data Lab — The Data Driver",
    template: "%s — The Data Driver",
  },
  description:
    "Open-source Formula 1 Data Lab: explore, compare and export race data from the public, non-commercial The Data Driver API.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-dark.svg", sizes: "32x32", type: "image/svg+xml" },
    ],
  },
  robots: { index: false, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#09090B",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="no-js antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.remove('no-js')" }} />
      </head>
      <body className="bg-dark text-light min-h-screen flex flex-col overflow-x-hidden">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-dark focus:px-4 focus:py-2 focus:text-light focus:outline focus:outline-2 focus:outline-teal"
        >
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
