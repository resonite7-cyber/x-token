import type { Metadata } from "next";

import "./globals.css";

import Providers from "./providers";
import SolanaProvider from "./solana-provider";
import Navbar from "./components/Navbar";

export const metadata: Metadata = {
  title: "Token Launcher",
  description: "Launch your token",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SolanaProvider>
            <Navbar />
            {children}
          </SolanaProvider>
        </Providers>
      </body>
    </html>
  );
}
