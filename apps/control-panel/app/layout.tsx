import './globals.css'
import React from 'react'

export const metadata = {
  title: 'FrijoleBot Control Panel',
  description: 'Admin UI for FrijoleBot settings and features',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}


