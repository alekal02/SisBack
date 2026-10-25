import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn
} from 'typeorm';

/**
 * Configuração da biblioteca de gráficos padrão por tipo de serviço.
 * Permite ao usuário ativar/desativar gráficos individuais na biblioteca
 * e salvar gráficos personalizados como padrão para um tipo de serviço.
 */
@Entity('graficos_padrao_config')
export class GraficoPadraoConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Chave única do gráfico no catálogo (ex: "tonelagem_por_veiculo") */
  @Column('varchar', { length: 100 })
  key!: string;

  /** Tipo de serviço ao qual este gráfico pertence */
  @Column('varchar', { length: 50 })
  tipoServico!: string;

  /** Se o gráfico está ativo na biblioteca (gerado automaticamente para novos serviços) */
  @Column({ default: true })
  ativo!: boolean;

  /** Título do gráfico */
  @Column('varchar', { length: 200 })
  titulo!: string;

  /** Tipo visual: barra, linha, pizza, area, donut */
  @Column('varchar', { length: 20 })
  tipo!: string;

  /** Placeholders para eixo X (JSON array) */
  @Column('jsonb', { nullable: true })
  placeholderEixoX!: string[] | null;

  /** Placeholders para eixo Y (JSON array) */
  @Column('jsonb', { nullable: true })
  placeholderEixoY!: string[] | null;

  /** Descrição do gráfico */
  @Column('text', { nullable: true })
  descricao!: string | null;

  /** Categoria para agrupamento visual */
  @Column('varchar', { length: 50, default: 'Operacional' })
  categoria!: string;

  /** Ordem de exibição */
  @Column('int', { default: 99 })
  ordem!: number;

  /** Se é gráfico de contagem (pizza/donut sem eixoY fixo) */
  @Column({ default: false })
  isContagem!: boolean;

  /** Cor tema */
  @Column('varchar', { length: 20, default: '#6366f1' })
  cor!: string;

  /** Se o gráfico foi salvo como personalizado pelo usuário */
  @Column({ default: false })
  isPersonalizado!: boolean;

  /** Referência ao serviço de origem (quando salvo como padrão de um serviço específico) */
  @Column('varchar', { length: 100, nullable: true })
  servicoOrigemId!: string | null;

  @CreateDateColumn()
  criadoEm!: Date;

  @UpdateDateColumn()
  atualizadoEm!: Date;
}
