import { Abastecimento } from '../entities/Abastecimento';
import { User } from '../entities/User';
import { Caminhao } from '../entities/Caminhao';
import { AbastecimentoLog } from '../entities/AbastecimentoLog';
import { ColetaData } from '../entities/ColetaData';
import { ColetaTotaisDia } from '../entities/ColetaTotaisDia';
import { PlanilhaUpload } from '../entities/PlanilhaUpload';
import { ImportacaoLinhaIgnorada } from '../entities/ImportacaoLinhaIgnorada';
import { Servico } from '../entities/Servico';
import { Contract } from '../entities/Contract';
import { KpiUniversal } from '../entities/KpiUniversal';
import { GraficoPadraoConfig } from '../entities/GraficoPadraoConfig';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';
import { Tenant } from '../entities/Tenant';
import { WhatsappGrupoRoteamento } from '../entities/WhatsappGrupoRoteamento';
import { WhatsappAutorizado } from '../entities/WhatsappAutorizado';
import { WhatsappTentativaNaoAutorizada } from '../entities/WhatsappTentativaNaoAutorizada';

/** Entidades do banco de controle (login, tenants, roteamento WhatsApp). */
export const CONTROL_ENTITIES = [
  User,
  Tenant,
  WhatsappGrupoRoteamento,
  WhatsappAutorizado,
  WhatsappTentativaNaoAutorizada,
  KpiUniversal,
  GraficoPadraoConfig,
];

/** Entidades de cada banco de contrato + controle legado (single-DB). */
export const TENANT_ENTITIES = [
  Abastecimento,
  User,
  Caminhao,
  AbastecimentoLog,
  ColetaData,
  ColetaTotaisDia,
  PlanilhaUpload,
  ImportacaoLinhaIgnorada,
  Contract,
  Servico,
  KpiUniversal,
  GraficoPadraoConfig,
  WhatsappGrupoMapa,
  Tenant,
  WhatsappGrupoRoteamento,
  WhatsappAutorizado,
  WhatsappTentativaNaoAutorizada,
];
