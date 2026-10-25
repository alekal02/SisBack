import { calcularExpressao, normalizarDados } from './FormulaEngine';
import {
  contarViagensValidadas,
  contarRotasValidadas,
  contarViagensPorRotaRegistro,
  obterContadorViagensRegistro,
  sumarizarViagensPorRota,
} from './viagensPorRotaService';

export interface DivergenciaContagemViagem {
  id?: number;
  linha?: number;
  data: string | null;
  placa: string | null;
  contadorPlanilha: number | null;
  viagensCalculadas: number;
  motivo: string;
}

export interface VerificacaoContagemViagens {
  periodo: { dataInicio?: string; dataFim?: string } | null;
  /** Linhas (rotas) no banco — equivalente a contar linhas da planilha importada */
  linhasImportadas: number;
  linhasValidasDashboard: number;
  linhasExcluidasDashboard: number;
  /** Soma literal da coluna CONTADOR DE VIAGENS (células vazias = 0) */
  somaContadorPlanilha: number;
  /** Soma com fallback (PESO 1–4 ou 1 viagem operacional) — VIAGENS_POR_ROTA() */
  viagensPorRota: number;
  /** Viagens em linhas validadas — VIAGENS_VALIDADAS() */
  viagensValidadas: number;
  /** Resultado de SUM(CONTADOR DE VIAGENS) no motor de fórmulas */
  sumContadorFormula: number;
  linhasSemContador: number;
  linhasComContador: number;
  linhasComFallback: number;
  /** true quando soma contador ≠ viagens validadas ou linhas ≠ expectativa comum */
  temDivergencia: boolean;
  explicacao: string[];
  divergencias: DivergenciaContagemViagem[];
}

function extrairDataIso(reg: Record<string, unknown>): string | null {
  const raw = reg.dataSaida ?? reg['DATA SAIDA'] ?? reg['DATA SAÍDA'] ?? reg['DATA'];
  if (!raw) return null;
  if (raw instanceof Date) {
    return `${raw.getUTCFullYear()}-${String(raw.getUTCMonth() + 1).padStart(2, '0')}-${String(raw.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s || null;
}

function somaContadorLiteral(dados: Record<string, unknown>[]): {
  soma: number;
  comContador: number;
  semContador: number;
} {
  let soma = 0;
  let comContador = 0;
  let semContador = 0;
  for (const reg of dados) {
    const c = obterContadorViagensRegistro(reg);
    if (c !== null && c > 0) {
      soma += c;
      comContador++;
    } else {
      semContador++;
    }
  }
  return { soma, comContador, semContador };
}

export function verificarContagemViagens(
  dadosBrutos: Record<string, unknown>[],
  opts?: { dataInicio?: string; dataFim?: string },
): VerificacaoContagemViagens {
  const dados = dadosBrutos || [];
  const dadosNorm = normalizarDados(dados);

  const { soma: somaContadorPlanilha, comContador: linhasComContador, semContador: linhasSemContador } =
    somaContadorLiteral(dadosNorm);

  const viagensPorRota = sumarizarViagensPorRota(dadosNorm);
  const viagensValidadas = contarViagensValidadas(dadosNorm);
  const linhasValidasDashboard = contarRotasValidadas(dadosNorm);

  let sumContadorFormula = 0;
  try {
    sumContadorFormula = calcularExpressao('SUM(CONTADOR DE VIAGENS)', { dados: dadosNorm, valoresFixos: {} }).valor;
  } catch {
    sumContadorFormula = somaContadorPlanilha;
  }

  const linhasExcluidasDashboard = dadosNorm.filter(
    (r: Record<string, unknown>) => r.validoDashboard === false || r._validoDashboard === false,
  ).length;

  const divergencias: DivergenciaContagemViagem[] = [];
  let linhasComFallback = 0;

  for (const reg of dadosNorm) {
    const contador = obterContadorViagensRegistro(reg);
    const calculado = contarViagensPorRotaRegistro(reg);
    if ((contador === null || contador <= 0) && calculado > 0) {
      linhasComFallback++;
      if (divergencias.length < 30) {
        divergencias.push({
          id: typeof reg.id === 'number' ? reg.id : undefined,
          data: extrairDataIso(reg),
          placa: reg.placa ? String(reg.placa) : reg.PLACA ? String(reg.PLACA) : null,
          contadorPlanilha: contador,
          viagensCalculadas: calculado,
          motivo: 'CONTADOR DE VIAGENS vazio — sistema estimou viagens pelos pesos ou dados operacionais',
        });
      }
    } else if (contador !== null && contador > 0 && contador !== calculado) {
      if (divergencias.length < 30) {
        divergencias.push({
          id: typeof reg.id === 'number' ? reg.id : undefined,
          data: extrairDataIso(reg),
          placa: reg.placa ? String(reg.placa) : reg.PLACA ? String(reg.PLACA) : null,
          contadorPlanilha: contador,
          viagensCalculadas: calculado,
          motivo: 'Contador da planilha difere do cálculo interno (PESO 1–4 ou limite máx. 4)',
        });
      }
    }
  }

  const explicacao: string[] = [];
  explicacao.push(
    `Cada linha da planilha é uma rota. O dashboard soma o CONTADOR DE VIAGENS de cada linha (1–4 viagens por rota), não conta só as linhas.`,
  );
  explicacao.push(
    `${linhasImportadasLabel(dados.length)} no período; ${linhasValidasDashboard} entram nos KPIs${linhasExcluidasDashboard > 0 ? ` (${linhasExcluidasDashboard} excluída(s) por KM/peso/dados inválidos)` : ''}.`,
  );

  if (linhasSemContador > 0) {
    explicacao.push(
      `${linhasSemContador} linha(s) sem CONTADOR DE VIAGENS preenchido — o KPI "Viagens Realizadas" estima ${linhasComFallback} delas via PESO 1–4 ou 1 viagem operacional.`,
    );
  }

  if (Math.round(somaContadorPlanilha) !== Math.round(viagensValidadas)) {
    explicacao.push(
      `Soma do contador na planilha (${Math.round(somaContadorPlanilha)}) ≠ Viagens Realizadas no dashboard (${Math.round(viagensValidadas)}) — verifique linhas excluídas ou contador vazio.`,
    );
  }

  if (Math.round(sumContadorFormula) !== Math.round(viagensPorRota)) {
    explicacao.push(
      `SUM(CONTADOR DE VIAGENS) (${Math.round(sumContadorFormula)}) ignora linhas sem contador; use VIAGENS_POR_ROTA() (${Math.round(viagensPorRota)}) para incluir fallback.`,
    );
  }

  const temDivergencia =
    linhasExcluidasDashboard > 0 ||
    linhasSemContador > 0 ||
    Math.round(somaContadorPlanilha) !== Math.round(viagensValidadas) ||
    divergencias.length > 0;

  return {
    periodo: opts?.dataInicio || opts?.dataFim
      ? { dataInicio: opts.dataInicio, dataFim: opts.dataFim }
      : null,
    linhasImportadas: dados.length,
    linhasValidasDashboard,
    linhasExcluidasDashboard,
    somaContadorPlanilha: Math.round(somaContadorPlanilha * 100) / 100,
    viagensPorRota: Math.round(viagensPorRota * 100) / 100,
    viagensValidadas: Math.round(viagensValidadas * 100) / 100,
    sumContadorFormula: Math.round(sumContadorFormula * 100) / 100,
    linhasSemContador,
    linhasComContador,
    linhasComFallback,
    temDivergencia,
    explicacao,
    divergencias,
  };
}

function linhasImportadasLabel(n: number): string {
  return `${n} linha(s) (rota(s)) importada(s)`;
}
