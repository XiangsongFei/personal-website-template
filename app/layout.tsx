import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo User | Data Analytics Portfolio Template",
  description:
    "A public, bilingual portfolio template for data analytics and information systems work.",
  keywords: [
    "Demo User",
    "Portfolio Template",
    "Data Analytics",
    "Business Analytics",
    "Machine Learning",
    "Information Systems",
  ],
  authors: [
    {
      name: "Demo User",
    },
  ],
  creator: "Demo User",

  openGraph: {
    title: "Demo User | Data Analytics Portfolio Template",
    description:
      "A public, bilingual portfolio template for data analytics and information systems work.",
    url: "https://example.com",
    siteName: "Demo User Portfolio",
    locale: "en_US",
    type: "website",
  },

  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
