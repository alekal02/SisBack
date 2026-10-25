export interface WarmupPedido {
  fullScan: boolean;
  maxContratos: number;
  maxServicos: number;
  servicos: string[];
}

export function calcularWarmupPedido(input: {
  fullScan: boolean;
  contratoTotal: number;
  servicoTotal: number;
  servicos?: string[];
  maxContratos?: number;
  maxServicos?: number;
}): WarmupPedido {
  const maxContratos = Number.isFinite(input.maxContratos) ? Math.max(1, Number(input.maxContratos)) : 1;
  const maxServicos = Number.isFinite(input.maxServicos) ? Math.max(1, Number(input.maxServicos)) : 1;

  if (input.fullScan) {
    return {
      fullScan: true,
      maxContratos: input.contratoTotal || 0,
      maxServicos: input.servicoTotal || 0,
      servicos: input.servicos ? [...input.servicos] : [],
    };
  }

  const servicosSelecionados = (input.servicos || []).slice(0, maxServicos);
  return {
    fullScan: false,
    maxContratos: Math.min(input.contratoTotal || 0, maxContratos),
    maxServicos: Math.min(input.servicoTotal || 0, maxServicos),
    servicos: servicosSelecionados,
  };
}
