export function viKashStatusLabel(status: string, code: string | null): string {
  if (code === 'CANCELLATION_CONFIRMED') return 'Cancelado no ViKash';
  if (code === 'LINK_REVOKED') return 'Envio interrompido por desconexão';
  return ({ PENDING: 'Envio pendente', SENT: 'Enviado ao ViKash', ERROR: 'Envio não confirmado', ACTION_REQUIRED: 'Precisa da sua atenção', CANCELLED: 'Envio desativado' } as Record<string, string>)[status] ?? status;
}
