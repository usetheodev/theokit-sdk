import type { ReactNode } from "react";

export const metadata = {
  title: "@usetheo/react demo",
  description: "Next.js example for useTheoChat / useTheoCompletion / useTheoAssistant",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
