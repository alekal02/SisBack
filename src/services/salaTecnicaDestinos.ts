/**
 * Sem grupoJid o relatório não vai para todos os grupos.
 * O envio amplo só ocorre com confirmarTodosGrupos explícito.
 */
export function decidirDestinosSalaTecnica(input: {
  grupoPedido: string;
  confirmarTodosGrupos: boolean;
  gruposAtivos: string[];
}): { destinos: string[] } | { erro: string } {
  const grupo = String(input.grupoPedido || '').trim();
  if (grupo) {
    if (grupo.length > 80 || /[\s,]/.test(grupo)) {
      return { erro: 'grupoJid inválido.' };
    }
    return { destinos: [grupo] };
  }

  if (!input.confirmarTodosGrupos) {
    return {
      erro: 'Informe grupoJid. O envio para todos os grupos exige confirmarTodosGrupos: true.',
    };
  }

  const destinos = [...new Set(input.gruposAtivos.map((g) => String(g || '').trim()).filter(Boolean))];
  if (!destinos.length) {
    return {
      erro: 'Nenhum grupo WhatsApp mapeado. Informe grupoJid ou mapeie um grupo no Sistemma.',
    };
  }
  return { destinos };
}
