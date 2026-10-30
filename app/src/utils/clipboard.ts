import * as Clipboard from 'expo-clipboard';

/**
 * Utilitário seguro para cópia de texto para a área de transferência.
 * Funciona de forma transparente em Android (Expo Go / nativo), iOS e Web.
 * Não emite logs de segredos nem expõe conteúdo em mensagens de erro.
 *
 * @param text Conteúdo a ser copiado.
 * @returns Promise<boolean> true se a cópia foi estritamente confirmada pelo sistema operacional; false caso contrário.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  try {
    if (typeof Clipboard?.setStringAsync === 'function') {
      const result = await Clipboard.setStringAsync(text);
      // Confirma sucesso estritamente quando o contrato boolean retornar true
      return result === true;
    }

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.clipboard?.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falha silenciosa de infraestrutura/permissão; chamador deve exibir aviso acionável
    return false;
  }

  return false;
}
