import { contarViagensValidadas, sumarizarViagensPorRota } from './viagensPorRotaService';
import { contarColetoresUnicos, calcularMediaTonPorColetorViagem } from './coletoresUnicosService';
import { contarMotoristasUnicos, contarPlacasUnicas, contarDistritosUnicos } from './contadoresAtivosKpiService';
import { colunaEhPlaca, normalizarPlaca } from '../utils/normalizarPlaca';
import { resolverValorUnitarioPorTipo } from '../config/pesoMaximoCaminhao';

/**
 * FormulaEngine — Motor de Formulas para KPIs
 */
type Agregacao = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX' | 'COUNT DISTINCT';
type FuncaoTransformacao = 'ROUND' | 'IF' | 'ABS' | 'MEDIAN' | 'PERCENTILE' | 'MULTIPLY' | 'DIVIDE';

interface FuncaoExtraida {
  texto: string;
  funcao: Agregacao | 'FATURAMENTO_EST';
  coluna: string;
  condicional?: {
    colunaCond: string;
    operador: string;
    valor: string;
  } | null;
}

interface ContextoCalculo {
  dados: Record<string, any>[];
  valoresFixos: Record<string, number>;
  debug?: boolean;
}

function encontrarParenteseFechamento(expr: string, inicio: number): number {
  if (expr[inicio] !== '(') return -1;
  let profundidade = 0;
  for (let i = inicio; i < expr.length; i++) {
    if (expr[i] === '(') profundidade++;
    else if (expr[i] === ')') {
      profundidade--;
      if (profundidade === 0) return i;
    }
  }
  return -1;
}

function extrairFuncoesAgregadas(expressao: string): FuncaoExtraida[] {
  const funcoes: FuncaoExtraida[] = [];
  const palavrasChave = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
  const ignorar = ['ROUND', 'IF', 'ABS', 'MEDIAN', 'PERCENTILE', 'MULTIPLY', 'DIVIDE', 'FATURAMENTO_EST'];
  let i = 0;
  while (i < expressao.length) {
    if (expressao[i] === ' ') { i++; continue; }
    const resto = expressao.substring(i).toUpperCase();
    // ⭐ Aceitar COUNT.DISTINCT( (com espaço) E COUNT(.DISTINCT (parêntese após COUNT)
    const ehCountDistinctEspaco = resto.startsWith('COUNT DISTINCT(');
    const ehCountDistinctParentese = resto.startsWith('COUNT(DISTINCT');
    if (ehCountDistinctEspaco || ehCountDistinctParentese) {
      let abreParentese: number;
      if (ehCountDistinctEspaco) {
        abreParentese = i + 'COUNT DISTINCT'.length;
      } else {
        // COUNT(DISTINCT ...) → o ( está logo após COUNT
        abreParentese = i + 'COUNT'.length;
      }
      if (expressao[abreParentese] === '(') {
        const fecha = encontrarParenteseFechamento(expressao, abreParentese);
        if (fecha > abreParentese) {
          const texto = expressao.substring(i, fecha + 1);
          let params = expressao.substring(abreParentese + 1, fecha).trim();
          // Se for COUNT(DISTINCT coluna), remover a palavra DISTINCT
          if (params.toUpperCase().startsWith('DISTINCT ')) {
            params = params.substring('DISTINCT '.length).trim();
          }
          funcoes.push({ texto, funcao: 'COUNT DISTINCT', coluna: params, condicional: null });
          i = fecha + 1;
          continue;
        }
      }
    }
    let encontrouAgregada = false;
    for (const kw of palavrasChave) {
      if (resto.startsWith(kw + '(')) {
        const eIgnorar = ignorar.some(ig => resto.startsWith(ig + '('));
        if (eIgnorar) continue;
        const abreParentese = i + kw.length;
        if (expressao[abreParentese] === '(') {
          const fecha = encontrarParenteseFechamento(expressao, abreParentese);
          if (fecha > abreParentese) {
            const texto = expressao.substring(i, fecha + 1);
            const params = expressao.substring(abreParentese + 1, fecha).trim();
            const seMatch = params.match(/^(.+?)\s+SE\s+(.+)$/i);
            let condicional = null;
            if (seMatch) {
              const colunaAlvo = seMatch[1].trim();
              const condicao = seMatch[2].trim();
              const condParts = condicao.match(/^(.+?)\s*(==|!=|>|<|>=|<=)\s*(?:"([^"]*)"|'([^']*)'|(\d+(?:\.\d+)?))\s*$/);
              if (condParts) {
                condicional = { colunaCond: condParts[1].trim(), operador: condParts[2], valor: condParts[3] || condParts[4] || condParts[5] };
              }
              funcoes.push({ texto, funcao: kw as Agregacao, coluna: colunaAlvo, condicional });
            } else {
              funcoes.push({ texto, funcao: kw as Agregacao, coluna: params, condicional: null });
            }
            i = fecha + 1;
            encontrouAgregada = true;
            break;
          }
        }
      }
    }
    if (encontrouAgregada) continue;
    if (resto.startsWith('FATURAMENTO_EST(')) {
      const abre = i + 'FATURAMENTO_EST'.length;
      if (expressao[abre] === '(') {
        const fecha = encontrarParenteseFechamento(expressao, abre);
        if (fecha > abre) {
          const texto = expressao.substring(i, fecha + 1);
          const params = expressao.substring(abre + 1, fecha).trim();
          const partes = params.split(',').map(p => p.trim());
          funcoes.push({ texto, funcao: 'FATURAMENTO_EST', coluna: partes[0] || '', condicional: null });
          i = fecha + 1;
          continue;
        }
      }
    }
    i++;
  }
  return funcoes;
}

function aplicarAgregacao(funcao: Agregacao, coluna: string, dados: Record<string, any>[]): number {
  if (funcao === 'COUNT' && coluna === '*') return dados.length;
  if (funcao === 'COUNT DISTINCT') {
    const valores = new Set(
      dados
        .map((d) => {
          const v = encontrarValorColuna(d, coluna);
          if (v === null || v === undefined || v === '') return null;
          if (colunaEhPlaca(coluna)) return normalizarPlaca(String(v)) || null;
          return v;
        })
        .filter((v) => v !== null && v !== undefined && v !== ''),
    );
    return valores.size;
  }
  const valores = dados.map(d => { const v = encontrarValorColuna(d, coluna); if (v === null || v === undefined) return NaN; const n = parseNumeroBr(v); return isNaN(n) ? NaN : n; }).filter(n => !isNaN(n));
  if (valores.length === 0) return 0;
  switch (funcao) {
    case 'SUM': return valores.reduce((a, b) => a + b, 0);
    case 'AVG': return valores.reduce((a, b) => a + b, 0) / valores.length;
    case 'MIN': return Math.min(...valores);
    case 'MAX': return Math.max(...valores);
    case 'COUNT': return valores.length;
    default: return 0;
  }
}

/**
 * Converte número de planilha.
 * Brasileiro: `1.234,56` e `1234,56`.
 * Decimal com ponto (QGIS / Excel numérico em texto): `1234.56`, `485.073`.
 * Milhar com vários pontos e sem vírgula: `1.234.567`.
 */
export function parseNumeroBr(valor: any): number {
  if (valor === null || valor === undefined || valor === '') return NaN;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : NaN;
  if (typeof valor === 'boolean' || valor instanceof Date) return NaN;

  let str = String(valor)
    .trim()
    .replace(/[\u00A0\u202F\s]/g, '')
    .replace(/r\$/gi, '')
    .replace(/%$/g, '');
  if (!str) return NaN;

  let negativo = false;
  if (str.startsWith('-') || str.startsWith('−')) {
    negativo = true;
    str = str.slice(1);
  } else if (str.startsWith('+')) {
    str = str.slice(1);
  }
  if (str.startsWith('(') && str.endsWith(')')) {
    negativo = true;
    str = str.slice(1, -1);
  }
  if (!str) return NaN;
  str = str.replace(/[a-zA-Z²³µ]+$/g, '');
  if (!/^\d[\d.,]*$/.test(str)) return NaN;

  const temVirgula = str.includes(',');
  const temPonto = str.includes('.');
  if (temVirgula && temPonto) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (temVirgula) {
    const partes = str.split(',');
    str = partes.length > 2 ? partes.join('') : `${partes[0]}.${partes[1]}`;
  } else if (temPonto && str.split('.').length > 2) {
    str = str.replace(/\./g, '');
  }

  const n = Number(str);
  if (!Number.isFinite(n)) return NaN;
  return negativo ? -n : n;
}

/** Número de célula de planilha, ou null quando a célula não é numérica. */
export function numeroPlanilha(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = parseNumeroBr(valor);
  return Number.isFinite(n) ? n : null;
}

export function normalizarChave(chave: string): string {
  return chave.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_\-\(\)\[\]\/\\,\.;:]+/g, '').replace(/[^A-Z0-9]/g, '');
}

/**
 * ⭐ Mapa de sinônimos para fallback automático de colunas
 * Quando uma coluna não é encontrada nos dados, tenta estas alternativas.
 */
const COLUNA_SINONIMOS: Record<string, string[]> = {
  'MOTORISTA': ['MOTORISTA', 'OPERADOR', 'NOME', 'COLETOR', 'FUNCIONARIO', 'FUNCIONÁRIO', 'EQUIPE', 'PLACA', 'MOT'],
  'DISTRITO': ['DISTRITO', 'BAIRRO', 'LOCAL', 'SETOR', 'ROTA', 'DESTINO', 'REGIAO', 'REGIÃO'],
  'REGIONAL': ['REGIONAL', 'REGIAO', 'REGIÃO', 'ZONA', 'DISTRITO', 'BAIRRO'],
  'PLACA': ['PLACA', 'CAMINHAO', 'CAMINHÃO', 'VEICULO', 'VEÍCULO', 'COLETOR', 'COLETORA', 'EQUIPAMENTO'],
  'TIPO CAMINHAO': ['TIPO CAMINHAO', 'TIPO_CAMINHAO', 'CAMINHAO', 'CAMINHÃO', 'TIPO DE CAMINHÃO', 'TIPO DE CAMINHAO', 'TIPODECAMINHAO', 'TIPO VEICULO', 'TIPO'],
  'PESO TOTAL': ['PESO TOTAL', 'PESO', 'PESOTOTAL', 'PESO_TOTAL', 'PESO_BRUTO', 'KG', 'PESO COLETADO', 'PESO (KG)'],
  // Não usar 'KM' genérico — confunde hodômetro (KM SAIDA BASE) com distância percorrida
  'KM TOTAL': ['KM TOTAL', 'KMTOTAL', 'KM_TOTAL', 'QUILOMETRO', 'DISTANCIA', 'KM RODADO', 'KILOMETRO'],
  'TURNO': ['TURNO', 'PERIODO', 'TURNO BASE', 'TURNO_BASE'],
};

export function encontrarValorColuna(dado: Record<string, any>, nomeColuna: string): any {
  if (!dado || !nomeColuna) return undefined;
  
  // Nível 0: match exato
  if (dado[nomeColuna] !== undefined && dado[nomeColuna] !== null) return dado[nomeColuna];
  
  const chaveNorm = normalizarChave(nomeColuna);
  
  // Nível 1: normalização
  for (const [k, v] of Object.entries(dado)) { if (v !== null && v !== undefined && normalizarChave(k) === chaveNorm) return v; }
  
  // Nível 2: sem espaços
  const semEspaco = chaveNorm.replace(/\s+/g, '');
  for (const [k, v] of Object.entries(dado)) { if (v !== null && v !== undefined && normalizarChave(k).replace(/\s+/g, '') === semEspaco) return v; }
  
  // Nível 3: a coluna contém o nome buscado (ex.: "PESO TOTAL KG" ⊃ "PESOTOTAL").
  // NÃO inverter (semEspaco.includes(chaveReal)): "PESO2".includes("ID") / tokens vazios
  // faziam o id da linha virar PESO 2–5 e inflar o PESO TOTAL.
  for (const [k, v] of Object.entries(dado)) {
    if (v === null || v === undefined) continue;
    if (buscaKmDeDistancia(nomeColuna) && colunaEhHodometro(k)) continue;
    const chaveReal = normalizarChave(k).replace(/\s+/g, '');
    if (chaveReal.length >= 4 && chaveReal.includes(semEspaco)) return v;
    if (chaveReal.length >= 5 && chaveReal.length >= semEspaco.length - 1 && semEspaco.includes(chaveReal)) return v;
  }
  
  // Nível 4: tokens comuns — só com tokens reais dos dois lados (id/PESO2 não batem)
  const tokensBuscados = semEspaco.split(/\s+/).filter(t => t.length > 2);
  if (tokensBuscados.length > 0) {
    for (const [k, v] of Object.entries(dado)) {
      if (v === null || v === undefined) continue;
      const chaveReal = normalizarChave(k).replace(/\s+/g, '');
      const tokensReal = chaveReal.split(/\s+/).filter(t => t.length > 2);
      if (tokensReal.length === 0) continue;
      const tokensComuns = tokensBuscados.filter(t => tokensReal.includes(t));
      if (tokensComuns.length === 0) continue;
      if (tokensComuns.length >= Math.min(tokensBuscados.length, tokensReal.length)) return v;
    }
  }
  
  // Nível 5: dados brutos (d.dados)
  if (dado.dados && typeof dado.dados === 'object' && !Array.isArray(dado.dados)) return encontrarValorColuna(dado.dados, nomeColuna);
  
  // ⭐ Nível 6: fallback por sinônimos — tenta colunas alternativas conhecidas
  const nomeUpper = nomeColuna.trim().toUpperCase();
  const sinonimos = COLUNA_SINONIMOS[nomeUpper];
  if (sinonimos && sinonimos.length > 0) {
    // Tenta cada sinônimo (pulando o primeiro que é o próprio nome)
    for (let i = 1; i < sinonimos.length; i++) {
      const valor = encontrarValorColuna(dado, sinonimos[i]);
      if (valor !== undefined && valor !== null && valor !== '') return valor;
    }
  }
  
  // Nível 7: busca em qualquer coluna que tenha valor não-nulo (último recurso para COUNT DISTINCT)
  // Só retorna a primeira coluna com valor se todas as tentativas falharam
  for (const [k, v] of Object.entries(dado)) {
    if (v !== null && v !== undefined && v !== '' && typeof v === 'string' && v.length > 1 && !/^\d+$/.test(v)) {
      // Para COUNT DISTINCT, qualquer coluna de texto serve como fallback genérico
      // Mas não queremos pegar colunas como "PESO TOTAL" que são numéricas
      const chaveReal = normalizarChave(k);
      if (!chaveReal.includes('PESO') && !chaveReal.includes('KM') && !chaveReal.includes('HORA') && !chaveReal.includes('DATA')) {
        return v;
      }
    }
  }
  
  return undefined;
}

function tokenizar(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const char = expr[i];
    if (char === ' ') { i++; continue; }
    if (/[0-9.]/.test(char)) { let num = ''; while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i]; i++; } tokens.push(num); continue; }
    if ('+-*/()'.includes(char)) { tokens.push(char); i++; continue; }
    if (/[a-zA-Z_]/.test(char)) { let id = ''; while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { id += expr[i]; i++; } tokens.push(id); continue; }
    i++;
  }
  return tokens;
}

function converterParaRPN(tokens: string[]): string[] {
  const precedencia: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const output: string[] = [];
  const operadores: string[] = [];
  for (const token of tokens) {
    if (/^-?\d+(\.\d+)?$/.test(token) || /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token)) { output.push(token); }
    else if (token === '(') { operadores.push(token); }
    else if (token === ')') { while (operadores.length > 0 && operadores[operadores.length - 1] !== '(') { output.push(operadores.pop()!); } operadores.pop(); }
    else if ('+-*/'.includes(token)) { while (operadores.length > 0 && operadores[operadores.length - 1] !== '(' && precedencia[operadores[operadores.length - 1]] >= precedencia[token]) { output.push(operadores.pop()!); } operadores.push(token); }
  }
  while (operadores.length > 0) output.push(operadores.pop()!);
  return output;
}

function avaliarRPN(rpn: string[]): number {
  const pilha: number[] = [];
  for (const token of rpn) {
    if (/^-?\d+(\.\d+)?$/.test(token)) { pilha.push(parseFloat(token)); }
    else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token) && !'+-*/'.includes(token)) { pilha.push(0); }
    else if ('+-*/'.includes(token)) { const b = pilha.pop() || 0; const a = pilha.pop() || 0; switch (token) { case '+': pilha.push(a + b); break; case '-': pilha.push(a - b); break; case '*': pilha.push(a * b); break; case '/': pilha.push(b !== 0 ? a / b : 0); break; } }
  }
  return pilha.length > 0 ? pilha[pilha.length - 1] : 0;
}

function avaliarExpressaoAritmetica(expressao: string): number {
  const tokens = tokenizar(expressao);
  if (tokens.length === 0) return 0;
  const rpn = converterParaRPN(tokens);
  return avaliarRPN(rpn);
}

function extrairConteudoEntreParenteses(expr: string, inicioAbre: number): { conteudo: string; fecha: number } | null {
  if (expr[inicioAbre] !== '(') return null;
  const fecha = encontrarParenteseFechamento(expr, inicioAbre);
  if (fecha < 0) return null;
  return { conteudo: expr.substring(inicioAbre + 1, fecha), fecha };
}

function calcularFaturamentoEstimado(
  colunaPeso: string,
  colunaTipo: string,
  dados: Record<string, any>[],
  valoresFixos: Record<string, number>,
): number {
  if (!dados || dados.length === 0) return 0;
  const temValor = ['VALOR_MINI', 'VALOR_TRUCK', 'VALOR_TOCO', 'VALOR_BASCULANTE', 'VALOR_TONELADA']
    .some((k) => (valoresFixos[k] ?? 0) > 0);
  if (!temValor) return 0;

  let total = 0;
  for (const d of dados) {
    const peso = parseNumeroBr(encontrarValorColuna(d, colunaPeso));
    if (isNaN(peso) || peso <= 0) continue;
    const tipoRaw = String(encontrarValorColuna(d, colunaTipo) || '');
    const toneladas = peso / 1000;
    const valorUnitario = resolverValorUnitarioPorTipo(tipoRaw, valoresFixos);
    total += toneladas * valorUnitario;
  }
  return total;
}

/**
 * Horas nas rotas = chegada na rota → saída da rota.
 * Fórmulas antigas passam (saída, chegada) e a virada de dia vira ~24h − o tempo real.
 * SUM(relógio) − SUM(relógio) também não é duração por registro.
 */
function substituirDuracaoRelogio(
  expr: string,
  regex: RegExp,
  troca: (match: string, ...grupos: string[]) => string,
): string {
  if (!regex.test(expr)) return expr;
  regex.lastIndex = 0;
  const substituida = expr.replace(regex, troca as (substring: string, ...args: string[]) => string);
  if (/SUM\s*\(\s*H(?:ORA|R)\s+/i.test(substituida)) return expr;
  return substituida;
}

export function corrigirFormulaHorasLegada(expressao: string): string {
  let expr = expressao;
  expr = expr.replace(
    /HORAS_PRODUTIVAS\s*\(\s*(HORA\s+S[AÁ][IÍ]DA\s+ROTA\s+0?\d)\s*,\s*(HORA\s+CHEGA(?:DA)?\s+ROTA\s+0?\d)\s*\)/gi,
    (_m, saida, chegada) => `HORAS_PRODUTIVAS(${chegada}, ${saida})`,
  );
  expr = substituirDuracaoRelogio(
    expr,
    /SUM\s*\(\s*(HORA\s+CHEGA(?:DA)?\s+BASE|HR\s+CHEGA\s+BASE)\s*\)\s*-\s*SUM\s*\(\s*(HORA\s+S[AÁ][IÍ]DA\s+BASE|HR\s+SAIDA\s+BASE)\s*\)/gi,
    (_m, chegada, saida) => `HORAS_PRODUTIVAS(${saida}, ${chegada})`,
  );
  expr = substituirDuracaoRelogio(
    expr,
    /SUM\s*\(\s*(HORA\s+S[AÁ][IÍ]DA\s+ROTA\s+0?\d)\s*\)\s*-\s*SUM\s*\(\s*(HORA\s+CHEGA(?:DA)?\s+ROTA\s+0?\d)\s*\)/gi,
    (_m, saida, chegada) => `HORAS_PRODUTIVAS(${chegada}, ${saida})`,
  );
  if (/HORAS_PRODUTIVAS\s*\(/i.test(expr)) {
    expr = expr.replace(/\)\s*\*\s*24\b/g, ')');
  }
  return expr;
}

function colunaEhHodometro(chave: string): boolean {
  const n = normalizarChave(chave);
  return n.includes('KM') && (n.includes('SAIDA') || n.includes('CHEGADA') || n.includes('ROTA') || n.includes('BASE'));
}

function buscaKmDeDistancia(nomeColuna: string): boolean {
  const n = normalizarChave(nomeColuna);
  if (colunaEhHodometro(nomeColuna)) return false;
  return n.includes('KM') || n.includes('QUILOMET') || n.includes('KILOMET') || n.includes('DISTANCIA') || n.includes('VARRID');
}

export function calcularExpressao(expressao: string, contexto: ContextoCalculo): { valor: number; debug?: Record<string, any> } {
  const { dados, valoresFixos = {}, debug = false } = contexto;
  const log: Record<string, any> = {};
  if (!expressao || typeof expressao !== 'string' || expressao.trim() === '') return { valor: 0 };
  if (debug) log.expressaoOriginal = expressao;
  let expr = corrigirFormulaHorasLegada(expressao);
  const funcoesAgregadas = extrairFuncoesAgregadas(expr);
  if (debug) log.funcoesAgregadas = funcoesAgregadas;
  for (const func of funcoesAgregadas) {
    const coluna = func.coluna === '*' ? '*' : func.coluna;
    let dadosFiltrados = dados;
    if (func.condicional) {
      const { colunaCond, operador, valor: valorCond } = func.condicional;
      dadosFiltrados = dados.filter(d => {
        const val = encontrarValorColuna(d, colunaCond);
        if (val === null || val === undefined) return false;
        if (!isNaN(Number(valorCond)) && typeof val === 'number') {
          const numVal = Number(val), numCond = Number(valorCond);
          switch (operador) { case '==': return numVal === numCond; case '!=': return numVal !== numCond; case '>': return numVal > numCond; case '<': return numVal < numCond; case '>=': return numVal >= numCond; case '<=': return numVal <= numCond; default: return true; }
        }
        const strVal = String(val).toUpperCase().trim(), strCond = String(valorCond).toUpperCase().trim();
        switch (operador) { case '==': return strVal === strCond; case '!=': return strVal !== strCond; case '>': return strVal > strCond; case '<': return strVal < strCond; case '>=': return strVal >= strCond; case '<=': return strVal <= strCond; default: return true; }
      });
    }
    const dadosNormalizados = dadosFiltrados.map(d => {
      const obj: Record<string, any> = { ...d };
      const nomeNormalizado = normalizarChave(coluna);
      for (const [k, v] of Object.entries(d)) { if (normalizarChave(k) === nomeNormalizado && !obj[coluna] && k !== coluna) obj[coluna] = v; }
      return obj;
    });
    let valor: number;
    if (func.funcao === 'FATURAMENTO_EST') {
      const partes = func.texto.match(/FATURAMENTO_EST\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/i);
      const colPeso = partes ? partes[1].trim() : coluna, colTipo = partes ? partes[2].trim() : coluna;
      valor = calcularFaturamentoEstimado(colPeso, colTipo, dadosFiltrados, valoresFixos);
    } else if (func.funcao === 'COUNT DISTINCT' || (func.funcao === 'COUNT' && coluna === '*')) {
      valor = aplicarAgregacao(func.funcao, coluna, dadosNormalizados);
    } else {
      valor = aplicarAgregacao(func.funcao as Agregacao, coluna, dadosNormalizados);
      if (valor === 0 && dadosFiltrados.length > 0) valor = aplicarAgregacao(func.funcao as Agregacao, coluna, dadosFiltrados);
    }
    const regex = new RegExp(func.texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    expr = expr.replace(regex, String(Math.round(valor * 100) / 100));
    if (debug) log[func.texto] = valor;
  }
  if (debug) log.aposAgregadas = expr;
  for (const [nome, valor] of Object.entries(valoresFixos)) {
    const regex = new RegExp('\\b' + nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    expr = expr.replace(regex, String(valor));
  }
  if (debug) log.aposConstantes = expr;
  const fatRegex = /FATURAMENTO_EST\s*\(/gi;
  let fatMatch;
  while ((fatMatch = fatRegex.exec(expr)) !== null) {
    const inicioAbre = fatMatch.index + fatMatch[0].length - 1;
    const resultado = extrairConteudoEntreParenteses(expr, inicioAbre);
    if (resultado) {
      const partes = resultado.conteudo.split(',').map(p => p.trim());
      const colPeso = partes[0] || '', colTipo = partes[1] || '';
      const v = calcularFaturamentoEstimado(colPeso, colTipo, dados, valoresFixos);
      expr = expr.substring(0, fatMatch.index) + String(v) + expr.substring(resultado.fecha + 1);
      if (debug) log['FATURAMENTO_EST'] = v; fatRegex.lastIndex = 0;
    }
  }
  // ⭐ VIAGENS_VALIDADAS() / VIAGENS_REALIZADAS() — viagens em linhas validadas no dashboard
  const viagensValidadasRegex = /VIAGENS_(?:VALIDADAS|REALIZADAS)\s*\(\s*\)/gi;
  let viagensValidadasMatch;
  while ((viagensValidadasMatch = viagensValidadasRegex.exec(expr)) !== null) {
    const totalValidadas = contarViagensValidadas(dados);
    expr = expr.substring(0, viagensValidadasMatch.index) + String(totalValidadas) + expr.substring(viagensValidadasMatch.index + viagensValidadasMatch[0].length);
    if (debug) log['VIAGENS_VALIDADAS'] = totalValidadas;
    viagensValidadasRegex.lastIndex = 0;
  }

  // ⭐ VIAGENS_POR_ROTA() — soma CONTADOR DE VIAGENS (até 4 por linha/rota)
  const viagensRotaRegex = /VIAGENS_POR_ROTA\s*\(\s*\)/gi;
  let viagensRotaMatch;
  while ((viagensRotaMatch = viagensRotaRegex.exec(expr)) !== null) {
    const totalViagens = sumarizarViagensPorRota(dados);
    expr = expr.substring(0, viagensRotaMatch.index) + String(totalViagens) + expr.substring(viagensRotaMatch.index + viagensRotaMatch[0].length);
    if (debug) log['VIAGENS_POR_ROTA'] = totalViagens;
    viagensRotaRegex.lastIndex = 0;
  }

  // ⭐ COLETORES_UNICOS() — nomes distintos em COLETOR 01–04 (mesma pessoa em várias viagens conta 1x)
  const coletoresUnicosRegex = /COLETORES_UNICOS\s*\(\s*\)/gi;
  let coletoresUnicosMatch;
  while ((coletoresUnicosMatch = coletoresUnicosRegex.exec(expr)) !== null) {
    const total = contarColetoresUnicos(dados);
    expr = expr.substring(0, coletoresUnicosMatch.index) + String(total) + expr.substring(coletoresUnicosMatch.index + coletoresUnicosMatch[0].length);
    if (debug) log['COLETORES_UNICOS'] = total;
    coletoresUnicosRegex.lastIndex = 0;
  }

  const motoristasUnicosRegex = /MOTORISTAS_UNICOS\s*\(\s*\)/gi;
  let motoristasUnicosMatch;
  while ((motoristasUnicosMatch = motoristasUnicosRegex.exec(expr)) !== null) {
    const total = contarMotoristasUnicos(dados);
    expr = expr.substring(0, motoristasUnicosMatch.index) + String(total) + expr.substring(motoristasUnicosMatch.index + motoristasUnicosMatch[0].length);
    if (debug) log['MOTORISTAS_UNICOS'] = total;
    motoristasUnicosRegex.lastIndex = 0;
  }

  const placasUnicasRegex = /PLACAS_UNICAS\s*\(\s*\)/gi;
  let placasUnicasMatch;
  while ((placasUnicasMatch = placasUnicasRegex.exec(expr)) !== null) {
    const total = contarPlacasUnicas(dados);
    expr = expr.substring(0, placasUnicasMatch.index) + String(total) + expr.substring(placasUnicasMatch.index + placasUnicasMatch[0].length);
    if (debug) log['PLACAS_UNICAS'] = total;
    placasUnicasRegex.lastIndex = 0;
  }

  const distritosUnicosRegex = /DISTRITOS_UNICOS\s*\(\s*\)/gi;
  let distritosUnicosMatch;
  while ((distritosUnicosMatch = distritosUnicosRegex.exec(expr)) !== null) {
    const total = contarDistritosUnicos(dados);
    expr = expr.substring(0, distritosUnicosMatch.index) + String(total) + expr.substring(distritosUnicosMatch.index + distritosUnicosMatch[0].length);
    if (debug) log['DISTRITOS_UNICOS'] = total;
    distritosUnicosRegex.lastIndex = 0;
  }

  // ⭐ MEDIA_TON_POR_COLETOR() — média ton/coletor por viagem (PESO TOTAL ÷ Nº DE COLETORES)
  const mediaTonColetorRegex = /MEDIA_TON_POR_COLETOR\s*\(\s*\)/gi;
  let mediaTonColetorMatch;
  while ((mediaTonColetorMatch = mediaTonColetorRegex.exec(expr)) !== null) {
    const media = calcularMediaTonPorColetorViagem(dados);
    expr = expr.substring(0, mediaTonColetorMatch.index) + String(media) + expr.substring(mediaTonColetorMatch.index + mediaTonColetorMatch[0].length);
    if (debug) log['MEDIA_TON_POR_COLETOR'] = media;
    mediaTonColetorRegex.lastIndex = 0;
  }

  // ⭐ HORAS_PRODUTIVAS(colSaida, colChegada) — calcula soma de horas por registro, corrigindo virada de dia
  //    Quando chegada < saida (formato decimal Excel), significa que virou o dia: (chegada + 1 - saida) * 24
  //    Útil para viagens que terminam no dia seguinte (ex: saída 22:00, chegada 02:00)
  const horasProdRegex = /HORAS_PRODUTIVAS\s*\(/gi;
  let horasProdMatch;
  while ((horasProdMatch = horasProdRegex.exec(expr)) !== null) {
    const inicioAbre = horasProdMatch.index + horasProdMatch[0].length - 1;
    const resultado = extrairConteudoEntreParenteses(expr, inicioAbre);
    if (resultado) {
      const partes = resultado.conteudo.split(',').map(p => p.trim());
      if (partes.length >= 2) {
        const colSaida = partes[0];
        const colChegada = partes[1];
        let totalHoras = 0;
        for (const d of dados) {
          const saida = parseNumeroBr(encontrarValorColuna(d, colSaida));
          const chegada = parseNumeroBr(encontrarValorColuna(d, colChegada));
          if (isNaN(saida) || isNaN(chegada) || saida <= 0 || chegada <= 0) continue;
          
          let diff = 0;
          if (saida < 1 && chegada < 1) {
            // Formato decimal Excel (0-1, onde 0.5 = 12:00)
            if (chegada < saida) {
              // ⭐ VIROU O DIA: chegada + 1 - saida (ex: 02:00 - 22:00 = 0.0833 + 1 - 0.9167 = 0.1666 = 4h)
              diff = (chegada + 1 - saida) * 24;
            } else {
              diff = (chegada - saida) * 24;
            }
          } else {
            // Já está em horas ou outro formato
            if (chegada < saida) {
              // ⭐ VIROU O DIA: adiciona 24h
              diff = chegada + 24 - saida;
            } else {
              diff = chegada - saida;
            }
          }
          if (diff > 0 && diff < 100) {
            totalHoras += diff;
          }
        }
        totalHoras = Math.round(totalHoras * 100) / 100;
        expr = expr.substring(0, horasProdMatch.index) + String(totalHoras) + expr.substring(resultado.fecha + 1);
        if (debug) log['HORAS_PRODUTIVAS'] = totalHoras;
        horasProdRegex.lastIndex = 0;
      }
    }
  }
  const ifRegex2 = /IF\s*\(/gi;
  let ifMatch2;
  while ((ifMatch2 = ifRegex2.exec(expr)) !== null) {
    const inicioAbre = ifMatch2.index + ifMatch2[0].length - 1;
    const resultado = extrairConteudoEntreParenteses(expr, inicioAbre);
    if (resultado) {
      const partes = resultado.conteudo.split(',').map(p => p.trim());
      if (partes.length >= 3) { const condResult = avaliarExpressaoAritmetica(partes[0]) > 0; const v = condResult ? (parseFloat(partes[1]) || 0) : (parseFloat(partes[2]) || 0); expr = expr.substring(0, ifMatch2.index) + String(v) + expr.substring(resultado.fecha + 1); if (debug) log['IF'] = v; ifRegex2.lastIndex = 0; }
    }
  }
  // ⭐ Processa NULLIF(a, b) — se a === b retorna 0, senão retorna a
  const nullifRegex = /NULLIF\s*\(/gi;
  let nullifMatch;
  while ((nullifMatch = nullifRegex.exec(expr)) !== null) {
    const inicioAbre = nullifMatch.index + nullifMatch[0].length - 1;
    const resultado = extrairConteudoEntreParenteses(expr, inicioAbre);
    if (resultado) {
      const partes = resultado.conteudo.split(',').map(p => p.trim());
      if (partes.length >= 2) {
        const v1 = avaliarExpressaoAritmetica(partes[0]);
        const v2 = avaliarExpressaoAritmetica(partes[1]);
        const v = v1 === v2 ? 0 : v1;
        expr = expr.substring(0, nullifMatch.index) + String(v) + expr.substring(resultado.fecha + 1);
        if (debug) log['NULLIF'] = v;
        nullifRegex.lastIndex = 0;
      }
    }
  }

  // ⭐ Ignorar RANK() OVER(...) — função SQL não implementada na FormulaEngine
  expr = expr.replace(/RANK\s*\(\s*\)\s*OVER\s*\([^)]*\)/gi, '0');

  // ⭐ Primeiro processa DIVIDE e MULTIPLY (antes de ROUND e ABS)
  // para que expressoes como ROUND(DIVIDE(a, b), 2) sejam resolvidas corretamente
  const divRegex2 = /DIVIDE\s*\(/gi;
  let divMatch2;
  while ((divMatch2 = divRegex2.exec(expr)) !== null) {
    const inicioAbre = divMatch2.index + divMatch2[0].length - 1;
    const resultado = extrairConteudoEntreParenteses(expr, inicioAbre);
    if (resultado) {
      const partes = resultado.conteudo.split(',').map(p => p.trim());
      if (partes.length >= 2) { const v1 = avaliarExpressaoAritmetica(partes[0]), v2 = avaliarExpressaoAritmetica(partes[1]); const v = v2 !== 0 ? v1 / v2 : 0; expr = expr.substring(0, divMatch2.index) + String(v) + expr.substring(resultado.fecha + 1); if (debug) log['DIVIDE'] = v; divRegex2.lastIndex = 0; }
    }
  }
  const multRegex2 = /MULTIPLY\s*\(/gi;
  let multMatch2;
  while ((multMatch2 = multRegex2.exec(expr)) !== null) {
    const inicioAbre = multMatch2.index + multMatch2[0].length - 1;
    const resultado = extrairConteudoEntreParenteses(expr, inicioAbre);
    if (resultado) {
      const partes = resultado.conteudo.split(',').map(p => p.trim());
      if (partes.length >= 2) { const v1 = avaliarExpressaoAritmetica(partes[0]), v2 = avaliarExpressaoAritmetica(partes[1]); const v = v1 * v2; expr = expr.substring(0, multMatch2.index) + String(v) + expr.substring(resultado.fecha + 1); if (debug) log['MULTIPLY'] = v; multRegex2.lastIndex = 0; }
    }
  }
  const roundRegex2 = /ROUND\s*\(/gi;
  let roundMatch2;
  while ((roundMatch2 = roundRegex2.exec(expr)) !== null) {
    const inicioAbre = roundMatch2.index + roundMatch2[0].length - 1;
    const resultado = extrairConteudoEntreParenteses(expr, inicioAbre);
    if (resultado) {
      const ultimaVirgula = resultado.conteudo.lastIndexOf(',');
      if (ultimaVirgula >= 0) { const val = avaliarExpressaoAritmetica(resultado.conteudo.substring(0, ultimaVirgula).trim()); const casas = parseInt(resultado.conteudo.substring(ultimaVirgula + 1).trim()) || 0; const v = parseFloat(val.toFixed(casas)); expr = expr.substring(0, roundMatch2.index) + String(v) + expr.substring(resultado.fecha + 1); if (debug) log['ROUND'] = v; roundRegex2.lastIndex = 0; }
    }
  }
  const absRegex2 = /ABS\s*\(/gi;
  let absMatch2;
  while ((absMatch2 = absRegex2.exec(expr)) !== null) {
    const inicioAbre = absMatch2.index + absMatch2[0].length - 1;
    const resultado = extrairConteudoEntreParenteses(expr, inicioAbre);
    if (resultado) { const v = Math.abs(avaliarExpressaoAritmetica(resultado.conteudo)); expr = expr.substring(0, absMatch2.index) + String(v) + expr.substring(resultado.fecha + 1); absRegex2.lastIndex = 0; }
  }
  if (debug) log.aposTransformacao = expr;
  try {
    const valorFinal = avaliarExpressaoAritmetica(expr);
    if (debug) log.valorFinal = valorFinal;
    return { valor: valorFinal, ...(debug ? { debug: log } : {}) };
  } catch (err: any) {
    if (debug) log.erro = err.message;
    return { valor: 0, ...(debug ? { debug: log } : {}) };
  }
}

export function normalizarDados(dados: Record<string, any>[]): Record<string, any>[] {
  return dados.map(d => {
    const obj: Record<string, any> = { ...d };
    for (const [chave, valor] of Object.entries(d)) {
      const trimmed = chave.trim();
      const upperSpaced = trimmed.toUpperCase().replace(/\s+/g, ' ');
      if (!(upperSpaced in obj)) obj[upperSpaced] = valor;
      const upperNoSpace = upperSpaced.replace(/\s+/g, '');
      if (!(upperNoSpace in obj)) obj[upperNoSpace] = valor;
      const alphaNum = upperNoSpace.replace(/[^A-Z0-9]/g, '');
      if (!(alphaNum in obj)) obj[alphaNum] = valor;
      const lower = trimmed.toLowerCase();
      if (!(lower in obj)) obj[lower] = valor;
      const semParenteses = upperSpaced.replace(/\s*\([^)]*\)\s*/g, ' ').trim().replace(/\s+/g, ' ');
      if (semParenteses !== upperSpaced && !(semParenteses in obj)) { obj[semParenteses] = valor; const semParentesesNoSpace = semParenteses.replace(/\s+/g, ''); if (!(semParentesesNoSpace in obj)) obj[semParentesesNoSpace] = valor; }
      const underscore = upperSpaced.replace(/\s+/g, '_');
      if (!(underscore in obj)) obj[underscore] = valor;
    }
    return obj;
  });
}

export function calcularKpiComFormula(expressao: string, dados: Record<string, any>[], valoresFixos?: Record<string, number>): number {
  if (!expressao || !dados || dados.length === 0) return 0;
  const dadosNorm = normalizarDados(dados);
  const resultado = calcularExpressao(expressao, { dados: dadosNorm, valoresFixos: valoresFixos || {} });
  return resultado.valor;
}

export function validarExpressao(expressao: string): { valido: boolean; erro?: string } {
  try {
    if (!expressao || expressao.trim() === '') return { valido: false, erro: 'Expressao vazia' };
    let abertos = 0;
    for (const char of expressao) { if (char === '(') abertos++; if (char === ')') abertos--; if (abertos < 0) return { valido: false, erro: 'Parenteses desbalanceados: ) sem (' }; }
    if (abertos !== 0) return { valido: false, erro: 'Parenteses desbalanceados: faltando )' };
    return { valido: true };
  } catch (err: any) { return { valido: false, erro: err.message }; }
}

/* ============================================================
   MODELO EXECUTIVO - Template de KPIs do Dashboard Executivo
   ============================================================ */
export interface KpiModeloExecutivo {
  nome: string;
  formula: string;
  grupo: 'financeiro' | 'operacional' | 'grafico' | 'analise';
  formato: 'moeda' | 'numero' | 'porcentagem';
  label: string;
  descricao: string;
  unidade: string;
  cor: string;
  colunasUsadas: string[];
}

export interface GrupoModeloExecutivo {
  nome: string;
  cor: string;
  indicadores: KpiModeloExecutivo[];
}

const R_REAIS = 'R$';

export const MODELO_EXECUTIVO_KPIS: GrupoModeloExecutivo[] = [
  {
    nome: 'Financeiro',
    cor: '#059669',
    indicadores: [
      {
        nome: 'Faturamento Total',
        formula: 'FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO)',
        grupo: 'financeiro',
        formato: 'moeda',
        label: 'Faturamento Total',
        descricao: 'Receita total estimada: soma de (PESO em toneladas × valor por tipo de caminhão) — detecta automaticamente TRUCK, TOCO, MINI conforme configurado no contrato',
        unidade: R_REAIS,
        cor: '#059669',
        colunasUsadas: ['PESO TOTAL', 'TIPO CAMINHAO'],
      },
      {
        nome: 'Faturamento Total (fallback)',
        formula: 'SUM(PESO TOTAL) / 1000 * 80',
        grupo: 'financeiro',
        formato: 'moeda',
        label: 'Faturamento (fallback R$80)',
        descricao: 'Faturamento estimado com valor de R$ 80/ton (usado quando nao ha valores configurados)',
        unidade: R_REAIS,
        cor: '#34d399',
        colunasUsadas: ['PESO TOTAL'],
      },
      {
        nome: 'Custo Operacional',
        formula: 'SUM(abastecimentos.valor)',
        grupo: 'financeiro',
        formato: 'moeda',
        label: 'Custo Operacional',
        descricao: 'Custo total de abastecimentos no periodo',
        unidade: R_REAIS,
        cor: '#ef4444',
        colunasUsadas: [],
      },
      {
        nome: 'Margem Bruta',
        formula: '(FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO) - SUM(abastecimentos.valor)) / FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO) * 100',
        grupo: 'financeiro',
        formato: 'porcentagem',
        label: 'Margem Bruta',
        descricao: 'Percentual de lucro bruto sobre o faturamento',
        unidade: '%',
        cor: '#f59e0b',
        colunasUsadas: ['PESO TOTAL', 'TIPO CAMINHAO'],
      },
      {
        nome: 'Ticket Medio',
        formula: 'FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO) / VIAGENS_POR_ROTA()',
        grupo: 'financeiro',
        formato: 'moeda',
        label: 'Ticket Medio',
        descricao: 'Valor medio por viagem',
        unidade: R_REAIS,
        cor: '#8b5cf6',
        colunasUsadas: ['PESO TOTAL', 'TIPO CAMINHAO'],
      },
    ],
  },
  {
    nome: 'Operacional',
    cor: '#3b82f6',
    indicadores: [
      {
        nome: 'Tonelagem Total',
        formula: 'SUM(PESO TOTAL) / 1000',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Tonelagem Total',
        descricao: 'Peso total transportado em toneladas',
        unidade: 't',
        cor: '#3b82f6',
        colunasUsadas: ['PESO TOTAL'],
      },
      {
        nome: 'KM Rodados',
        formula: 'SUM(KM TOTAL)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'KM Rodados',
        descricao: 'Quilometragem total rodada no periodo',
        unidade: 'km',
        cor: '#06b6d4',
        colunasUsadas: ['KM TOTAL'],
      },
      {
        nome: 'Viagens',
        formula: 'VIAGENS_POR_ROTA()',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Viagens',
        descricao: 'Quantidade de viagens: CONTADOR DE VIAGENS da planilha; se vazio, conta rotas 01–04',
        unidade: 'un',
        cor: '#14b8a6',
        colunasUsadas: [],
      },
      {
        nome: 'Horas Produtivas',
        formula: 'HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Horas Produtivas',
        descricao: 'Total de horas em operacao - soma de (HORA CHEGADA BASE - HORA SAIDA BASE) por registro, com correcao de virada de dia',
        unidade: 'h',
        cor: '#f97316',
        colunasUsadas: ['HORA SAIDA BASE', 'HORA CHEGADA BASE'],
      },
      {
        nome: 'Eficiencia',
        formula: 'DIVIDE(SUM(PESO TOTAL) / 1000, SUM(KM TOTAL))',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Eficiencia (ton/km)',
        descricao: 'Toneladas transportadas por quilometro rodado',
        unidade: 't/km',
        cor: '#84cc16',
        colunasUsadas: ['PESO TOTAL', 'KM TOTAL'],
      },
      {
        nome: 'Receita por Km',
        formula: 'DIVIDE(FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO), SUM(KM TOTAL))',
        grupo: 'grafico',
        formato: 'moeda',
        label: 'Receita por Km',
        descricao: 'Faturamento dividido pelos km rodados',
        unidade: R_REAIS,
        cor: '#a855f7',
        colunasUsadas: ['PESO TOTAL', 'TIPO CAMINHAO', 'KM TOTAL'],
      },
      {
        nome: 'Receita por Hora',
        formula: 'DIVIDE(FATURAMENTO_EST(PESO TOTAL, TIPO CAMINHAO), HORAS_PRODUTIVAS(HORA SAIDA BASE, HORA CHEGADA BASE))',
        grupo: 'grafico',
        formato: 'moeda',
        label: 'Receita por Hora',
        descricao: 'Faturamento dividido pelas horas produtivas (HORA CHEGADA BASE - HORA SAIDA BASE por registro, com correcao de virada de dia)',
        unidade: R_REAIS,
        cor: '#ec4899',
        colunasUsadas: ['PESO TOTAL', 'TIPO CAMINHAO', 'HORA SAIDA BASE', 'HORA CHEGADA BASE'],
      },
    ],
  },
  // ═══ ROÇADA ═══
  {
    nome: 'Rocada',
    cor: '#22c55e',
    indicadores: [
      {
        nome: 'M2 Rocada por Bairro',
        formula: 'ROUND(DIVIDE(SUM(M2), COUNT DISTINCT(BAIRRO)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'M2 Rocada por Bairro',
        descricao: 'Media de metros quadrados rocados por bairro — distribuicao geografica do servico de rocada',
        unidade: 'm2/bairro',
        cor: '#22c55e',
        colunasUsadas: ['M2', 'BAIRRO'],
      },
      {
        nome: 'M2 Rocada por Equipamento',
        formula: 'ROUND(DIVIDE(SUM(M2), COUNT DISTINCT(EQUIPAMENTO)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'M2 Rocada por Equipamento',
        descricao: 'Media de metros quadrados rocados por equipamento — produtividade dos equipamentos',
        unidade: 'm2/equip',
        cor: '#16a34a',
        colunasUsadas: ['M2', 'EQUIPAMENTO'],
      },
      {
        nome: 'M2 Rocada por Operador',
        formula: 'ROUND(DIVIDE(SUM(M2), COUNT DISTINCT(OPERADOR)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'M2 Rocada por Operador',
        descricao: 'Media de metros quadrados rocados por operador — produtividade individual',
        unidade: 'm2/operador',
        cor: '#15803d',
        colunasUsadas: ['M2', 'OPERADOR'],
      },
      {
        nome: 'M2 Rocada por Dia',
        formula: 'ROUND(DIVIDE(SUM(M2), COUNT DISTINCT(DATA)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'M2 Rocada por Dia',
        descricao: 'Media de metros quadrados rocados por dia — produtividade diaria da rocada',
        unidade: 'm2/dia',
        cor: '#4ade80',
        colunasUsadas: ['M2', 'DATA'],
      },
      {
        nome: 'M2 Rocada por Equipe',
        formula: 'ROUND(DIVIDE(SUM(M2), COUNT DISTINCT(EQUIPE)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'M2 Rocada por Equipe',
        descricao: 'Media de metros quadrados rocados por equipe — produtividade das equipes',
        unidade: 'm2/equipe',
        cor: '#86efac',
        colunasUsadas: ['M2', 'EQUIPE'],
      },
      {
        nome: 'Receita M2 Hora Rocada',
        formula: 'ROUND(DIVIDE(SUM(M2) * VALOR_HORA_ROCADA, SUM(HORAS)), 2)',
        grupo: 'financeiro',
        formato: 'moeda',
        label: 'Receita M2/Hora Rocada',
        descricao: 'Receita estimada por hora de rocada (M2 x VALOR_HORA_ROCADA / HORAS)',
        unidade: 'R$/h',
        cor: '#059669',
        colunasUsadas: ['M2', 'HORAS'],
      },
    ],
  },
  // ═══ VARRIÇÃO ═══
  {
    nome: 'Varricao',
    cor: '#06b6d4',
    indicadores: [
      {
        nome: 'Varredores por Dia',
        formula: 'ROUND(DIVIDE(SUM(VARREDORES), COUNT DISTINCT(DATA)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Varredores por Dia',
        descricao: 'Media de varredores alocados por dia — dimensionamento da equipe de varricao',
        unidade: 'varredores/dia',
        cor: '#06b6d4',
        colunasUsadas: ['VARREDORES', 'DATA'],
      },
      {
        nome: 'KM Varrido por Dia',
        formula: 'ROUND(DIVIDE(SUM(KM VARRIDO), COUNT DISTINCT(DATA)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'KM Varrido por Dia',
        descricao: 'Media de quilometros varridos por dia — produtividade diaria',
        unidade: 'km/dia',
        cor: '#22d3ee',
        colunasUsadas: ['KM VARRIDO', 'DATA'],
      },
    ],
  },
  // ═══ PODA ═══
  {
    nome: 'Poda',
    cor: '#8b5cf6',
    indicadores: [
      {
        nome: 'Arvores por Dia',
        formula: 'ROUND(DIVIDE(SUM(Quantidade de Arvore), COUNT DISTINCT(DATA)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Arvores por Dia',
        descricao: 'Media de arvores por dia — soma de Quantidade de Arvore',
        unidade: 'arvores/dia',
        cor: '#8b5cf6',
        colunasUsadas: ['Quantidade de Arvore', 'DATA'],
      },
      {
        nome: 'Arvores Podadas',
        formula: 'SUM(Quantidade de Arvore)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Arvores Podadas',
        descricao: 'Soma da Quantidade de Arvore no periodo',
        unidade: 'arvores',
        cor: '#a78bfa',
        colunasUsadas: ['Quantidade de Arvore'],
      },
      {
        nome: 'Arvores Extirpadas',
        formula: 'SUM(Quantidade de Arvore)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Arvores Extirpadas',
        descricao: 'Soma da Quantidade de Arvore no periodo',
        unidade: 'arvores',
        cor: '#c4b5fd',
        colunasUsadas: ['Quantidade de Arvore'],
      },
    ],
  },
  // ═══ REMOÇÃO ═══
  {
    nome: 'Remocao',
    cor: '#f59e0b',
    indicadores: [
      {
        nome: 'Equipes Remocao por Dia',
        formula: 'ROUND(DIVIDE(COUNT DISTINCT(EQUIPE), COUNT DISTINCT(DATA)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Equipes Remocao por Dia',
        descricao: 'Media de equipes de remocao alocadas por dia',
        unidade: 'equipes/dia',
        cor: '#f59e0b',
        colunasUsadas: ['EQUIPE', 'DATA'],
      },
      {
        nome: 'Toneladas Removidas por Dia',
        formula: 'ROUND(DIVIDE(SUM(PESO) / 1000, COUNT DISTINCT(DATA)), 2)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Toneladas Removidas por Dia',
        descricao: 'Media de toneladas removidas por dia',
        unidade: 't/dia',
        cor: '#fbbf24',
        colunasUsadas: ['PESO', 'DATA'],
      },
      {
        nome: 'Tonelada por Equipe Remocao',
        formula: 'ROUND(DIVIDE(SUM(PESO) / 1000, COUNT DISTINCT(EQUIPE)), 2)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Tonelada por Equipe Remocao',
        descricao: 'Tonelagem media removida por equipe',
        unidade: 't/equipe',
        cor: '#fde68a',
        colunasUsadas: ['PESO', 'EQUIPE'],
      },
      {
        nome: 'Tonelada por Equipamento Remocao',
        formula: 'ROUND(DIVIDE(SUM(PESO) / 1000, COUNT DISTINCT(EQUIPAMENTO)), 2)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Tonelada por Equipamento Remocao',
        descricao: 'Tonelagem media removida por equipamento',
        unidade: 't/equip',
        cor: '#fef3c7',
        colunasUsadas: ['PESO', 'EQUIPAMENTO'],
      },
    ],
  },
  // ═══ LIMPEZA DE FEIRAS ═══
  {
    nome: 'Limpeza de Feiras',
    cor: '#14b8a6',
    indicadores: [
      {
        nome: 'M2 Limpos Feiras por Dia',
        formula: 'ROUND(DIVIDE(SUM(M2_FEIRAS), COUNT DISTINCT(DATA)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'M2 Limpos Feiras por Dia',
        descricao: 'Media de metros quadrados limpos por dia nas feiras livres',
        unidade: 'm2/dia',
        cor: '#14b8a6',
        colunasUsadas: ['M2_FEIRAS', 'DATA'],
      },
      {
        nome: 'Varredores Feiras por Dia',
        formula: 'ROUND(DIVIDE(SUM(VARREDORES_FEIRAS), COUNT DISTINCT(DATA)), 1)',
        grupo: 'operacional',
        formato: 'numero',
        label: 'Varredores Feiras por Dia',
        descricao: 'Media de varredores alocados por dia nas feiras livres',
        unidade: 'varredores/dia',
        cor: '#2dd4bf',
        colunasUsadas: ['VARREDORES_FEIRAS', 'DATA'],
      },
    ],
  },
  // ═══ MELHORIAS OPERACIONAIS ═══
  {
    nome: 'Melhorias Operacionais',
    cor: '#3b82f6',
    indicadores: [
      {
        nome: 'Top Motoristas Tonelagem',
        formula: 'ROUND(SUM(PESO) / 1000, 1)',
        grupo: 'analise',
        formato: 'numero',
        label: 'Top Motoristas (Tonelagem)',
        descricao: 'Ranking de motoristas por tonelagem — agrupe por MOTORISTA e ordene decrescente',
        unidade: 't',
        cor: '#3b82f6',
        colunasUsadas: ['PESO'],
      },
      {
        nome: 'Top Coletores TonDia',
        formula: 'ROUND(SUM(PESO) / 1000 / COUNT DISTINCT(DATA), 2)',
        grupo: 'analise',
        formato: 'numero',
        label: 'Top Coletores (Ton/Dia)',
        descricao: 'Ranking de coletores por produtividade diaria — agrupe por COLETOR e ordene decrescente',
        unidade: 't/dia',
        cor: '#2563eb',
        colunasUsadas: ['PESO', 'DATA'],
      },
      {
        nome: 'Top Rotas Tonelagem',
        formula: 'ROUND(SUM(PESO) / 1000, 1)',
        grupo: 'analise',
        formato: 'numero',
        label: 'Top Rotas (Tonelagem)',
        descricao: 'Ranking de rotas por tonelagem total — agrupe por ROTA e ordene decrescente',
        unidade: 't',
        cor: '#1d4ed8',
        colunasUsadas: ['PESO'],
      },
    ],
  },
];

export default {
  calcularExpressao,
  calcularKpiComFormula,
  validarExpressao,
  normalizarDados,
  extrairFuncoesAgregadas,
  MODELO_EXECUTIVO_KPIS,
};
