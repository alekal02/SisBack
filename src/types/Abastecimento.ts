/**
 * Tipos para o módulo de Abastecimento
 * Define contratos de dados para abastecimentos de caminhões
 */

/**
 * Representa um abastecimento de caminhão
 */
export interface Abastecimento {
  id: string; // UUID
  placa: string; // Placa do caminhão
  litragem: number; // Litros abastecidos
  valor: number; // Valor em reais
  horario: string; // Horário do abastecimento (HH:MM)
  dataAbastecimento: string; // Data em ISO 8601 (YYYY-MM-DD)
  imagemUrl: string; // URL ou path local da imagem
  statusExtracao: 'pendente' | 'sucesso' | 'erro'; // Status da extração OCR
  observacoes?: string; // Observações opcionais do operador
  criadoEm: string; // Timestamp ISO 8601
  atualizadoEm: string; // Timestamp ISO 8601
}

/**
 * Dados extraídos automaticamente pela OCR
 */
export interface DadosExtraidosOCR {
  litragem: number | null;
  valor: number | null;
  confianca: number; // 0-1, indica confiança da extração
  textoRaw: string; // Texto bruto extraído
  erroExtracao?: string; // Se houver erro
}

/**
 * Requisição para criar abastecimento
 */
export interface CriarAbastecimentoRequest {
  placa: string;
  litragem?: number; // Opcional, pode vir do OCR
  valor?: number; // Opcional, pode vir do OCR
  dataHora: string;
  imagemUrl: string;
  observacoes?: string;
  litragemExtraida?: number | null; // Valor extraído pela OCR (original)
  valorExtraido?: number | null; // Valor extraído pela OCR (original)
}

/**
 * Resposta da API de criação
 */
export interface AbastecimentoResponse {
  sucesso: boolean;
  dados?: Abastecimento;
  erro?: string;
  dadosExtraidos?: DadosExtraidosOCR; // Retorna dados extraídos para confirmação do usuário
}

/**
 * Filtros para listar abastecimentos
 */
export interface FiltrosRelatorio {
  dataInicio?: string; // YYYY-MM-DD
  dataFim?: string; // YYYY-MM-DD
  placa?: string;
  statusExtracao?: 'pendente' | 'sucesso' | 'erro';
  usuarioCriadorId?: string; // Filtrar por usuário que criou
  page?: number; // Página atual (1-based)
  limit?: number; // Registros por página (0 = todos)
}

/**
 * Resposta paginada de abastecimentos
 */
export interface RespostaPaginada {
  abastecimentos: Abastecimento[];
  total: number;
  pagina: number;
  totalPaginas: number;
  limite: number;
}
