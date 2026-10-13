import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import '../features/jobs/jobs.css';

export const metadata: Metadata = {
  title: 'Chambeaya Empresas',
  description: process.env.NEXT_PUBLIC_TEMPORARY_SHIFTS_ENABLED === 'true'
    ? 'Gestiona turnos, cobertura y operaciones de tu empresa en Chambeaya'
    : 'Publica puestos fijos, selecciona talento y administra tu saldo en Chambeaya'
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
