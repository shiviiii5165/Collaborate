import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Collaborate. by AI Tathastu — Independent Professional Networking',
  description:
    'Great work begins with the right people. Independent professional networking, verified profiles, WhatsApp-inspired messaging simplicity, and transparent AI recommendations.',
  keywords: [
    'Collaborate',
    'AI Tathastu',
    'Professional Networking',
    'AI Engineers',
    'GenAI Builders',
    'Verified Badges',
    'Real-time Messaging',
  ],
  authors: [{ name: 'AI Tathastu Engineering Team' }],
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
