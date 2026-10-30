import type { Metadata } from "next";
import type { ReactNode } from "react";
import Nav from "@/components/Nav";
import Palette from "@/components/Palette";
import { ToastProvider } from "@/components/Toast";
import { ConfirmProvider } from "@/components/kit";
import Shortcuts from "@/components/Shortcuts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Windward",
  description: "Self-hostable Rust-native data platform on Sail and dbt.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider><ConfirmProvider>
          <div className="shell">
            <Nav />
            <main className="main">{children}</main>
            <Palette />
            <Shortcuts />
          </div>
        </ConfirmProvider></ToastProvider>
      </body>
    </html>
  );
}
