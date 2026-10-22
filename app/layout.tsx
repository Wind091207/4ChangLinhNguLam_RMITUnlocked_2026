import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { TideCloakProvider } from '@tidecloak/nextjs'
import tcConfig from '../tidecloak.json'
import './globals.css'

export const metadata: Metadata = {
  title: 'DualKey Expense Desk · Built with TideCloak (RMIT UNLOCKED)',
  description:
    'Quorum-governed high-value expense approvals and E2EE payee protection powered by TideCloak Emergent Authority.',
}

interface RootLayoutProps {
  children: ReactNode
}

const providerConfig = {
  ...tcConfig,
  useDPoP: { mode: 'strict' as const, alg: 'ES256' as const },
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <div className="cosmos" aria-hidden="true" />
        <TideCloakProvider config={providerConfig}>{children}</TideCloakProvider>
      </body>
    </html>
  )
}
