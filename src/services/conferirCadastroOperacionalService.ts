import { ConfigOperacionalContrato, normalizarNomeOperacional } from '../utils/configOperacional';
import { normalizarPlaca } from '../utils/normalizarPlaca';

export interface ConferenciaEntidadeCadastro {
  tipo: 'placas' | 'motoristas' | 'coletores';
  cadastrados: number;
  naPlanilha: number;
  emComum: number;
  /** Cadastrados que não apareceram na planilha */
  soCadastro: string[];
  /** Apareceram na planilha mas não estão no cadastro */
  soPlanilha: string[];
  cadastroVazio: boolean;
}

export interface ConferenciaCadastroOperacional {
  ativa: boolean;
  temDivergencia: boolean;
  resumo: string;
  placas: ConferenciaEntidadeCadastro;
  motoristas: ConferenciaEntidadeCadastro;
  coletores: ConferenciaEntidadeCadastro;
}

export interface ValoresPlanilhaCadastro {
  placas: Set<string>;
  motoristas: Set<string>;
  coletores: Set<string>;
}

function compararConjuntos(
  tipo: ConferenciaEntidadeCadastro['tipo'],
  cadastro: string[],
  planilha: Set<string>,
): ConferenciaEntidadeCadastro {
  const setCadastro = new Set(cadastro);
  const emComum: string[] = [];
  const soCadastro: string[] = [];
  const soPlanilha: string[] = [];

  for (const item of setCadastro) {
    if (planilha.has(item)) emComum.push(item);
    else soCadastro.push(item);
  }
  for (const item of planilha) {
    if (!setCadastro.has(item)) soPlanilha.push(item);
  }

  soCadastro.sort();
  soPlanilha.sort();

  return {
    tipo,
    cadastrados: setCadastro.size,
    naPlanilha: planilha.size,
    emComum: emComum.length,
    soCadastro,
    soPlanilha,
    cadastroVazio: setCadastro.size === 0,
  };
}

function montarResumo(
  placas: ConferenciaEntidadeCadastro,
  motoristas: ConferenciaEntidadeCadastro,
  coletores: ConferenciaEntidadeCadastro,
): string {
  const partes: string[] = [];
  if (!placas.cadastroVazio) {
    if (placas.soPlanilha.length) partes.push(`${placas.soPlanilha.length} placa(s) fora do cadastro`);
    if (placas.soCadastro.length) partes.push(`${placas.soCadastro.length} placa(s) cadastrada(s) ausente(s) na planilha`);
  }
  if (!motoristas.cadastroVazio) {
    if (motoristas.soPlanilha.length) partes.push(`${motoristas.soPlanilha.length} motorista(s) fora do cadastro`);
    if (motoristas.soCadastro.length) partes.push(`${motoristas.soCadastro.length} motorista(s) cadastrado(s) ausente(s) na planilha`);
  }
  if (!coletores.cadastroVazio) {
    if (coletores.soPlanilha.length) partes.push(`${coletores.soPlanilha.length} coletor(es) fora do cadastro`);
    if (coletores.soCadastro.length) partes.push(`${coletores.soCadastro.length} coletor(es) cadastrado(s) ausente(s) na planilha`);
  }
  if (partes.length === 0) return 'Cadastro operacional conferido — planilha alinhada com o cadastro.';
  return partes.join(' · ');
}

export function conferirCadastroOperacional(
  cadastro: ConfigOperacionalContrato | null | undefined,
  planilha: ValoresPlanilhaCadastro,
): ConferenciaCadastroOperacional | null {
  if (!cadastro) return null;

  const placasCad = (cadastro.placasAtivas ?? []).map((p) => normalizarPlaca(p)).filter(Boolean);
  const motoristasCad = (cadastro.motoristas ?? []).map((m) => normalizarNomeOperacional(m)).filter(Boolean) as string[];
  const coletoresCad = (cadastro.coletores ?? []).map((c) => normalizarNomeOperacional(c)).filter(Boolean) as string[];

  if (placasCad.length === 0 && motoristasCad.length === 0 && coletoresCad.length === 0) {
    return null;
  }

  const placas = compararConjuntos('placas', placasCad, planilha.placas);
  const motoristas = compararConjuntos('motoristas', motoristasCad, planilha.motoristas);
  const coletores = compararConjuntos('coletores', coletoresCad, planilha.coletores);

  const temDivergencia = [placas, motoristas, coletores].some(
    (c) => !c.cadastroVazio && (c.soCadastro.length > 0 || c.soPlanilha.length > 0),
  );

  return {
    ativa: true,
    temDivergencia,
    resumo: montarResumo(placas, motoristas, coletores),
    placas,
    motoristas,
    coletores,
  };
}
