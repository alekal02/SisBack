import { Request, Response } from 'express';
import AppDataSource from '../database/data-source';
import { WhatsappGrupoMapa } from '../entities/WhatsappGrupoMapa';
import wuzapiService, { redigirSegredos } from '../services/WuzapiService';
import {
  listarContatosAgenda,
  listarParticipantesAgenda,
  mensagemErroLotePublica,
  redigirTelefones,
} from '../services/whatsappAgendaContatos';
import {
  autorizarPessoasEmLote,
  telefonesAutorizadosDoContrato,
} from '../services/whatsappAutorizadoLote';

function logSeguro(linha: string): void {
  console.info(redigirTelefones(redigirSegredos(linha)));
}

function contractIdDaQuery(req: Request): string {
  const valor = req.query.contractId;
  return String(Array.isArray(valor) ? valor[0] : valor || '').trim();
}

async function jidsDoContrato(contractId: string): Promise<string[]> {
  const lista = await AppDataSource.getRepository(WhatsappGrupoMapa).find({
    relations: ['servico'],
  });
  return lista
    .filter((grupo) => grupo.servico?.contract_id === contractId)
    .map((grupo) => grupo.grupoJid);
}

export async function listarContatosHttp(req: Request, res: Response): Promise<void> {
  try {
    const contractId = contractIdDaQuery(req);
    if (!contractId) {
      res.status(400).json({ error: 'Informe o contrato.' });
      return;
    }
    const sessao = await wuzapiService.sessaoDaInstancia();
    const autorizados = sessao.logado ? await telefonesAutorizadosDoContrato(contractId) : [];
    const resultado = await listarContatosAgenda({
      role: req.usuario?.role,
      contractIdUsuario: req.usuario?.contractId,
      contractId,
      sessao,
      buscarContatos: () => wuzapiService.baixarContatos(),
      telefonesAutorizados: autorizados,
      log: logSeguro,
    });
    res.status(resultado.status).json(resultado.body);
  } catch (error: unknown) {
    console.error(`[Wuzapi] ${redigirTelefones(redigirSegredos(error instanceof Error ? error.message : 'falha'))}`);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao listar contatos' });
  }
}

export async function listarParticipantesHttp(req: Request, res: Response): Promise<void> {
  try {
    const contractId = contractIdDaQuery(req);
    if (!contractId) {
      res.status(400).json({ error: 'Informe o contrato.' });
      return;
    }
    const sessao = await wuzapiService.sessaoDaInstancia();
    const [autorizados, grupos] = sessao.logado
      ? await Promise.all([
        telefonesAutorizadosDoContrato(contractId),
        jidsDoContrato(contractId),
      ])
      : [[], []];
    const resultado = await listarParticipantesAgenda({
      role: req.usuario?.role,
      contractIdUsuario: req.usuario?.contractId,
      contractId,
      jid: String(req.params.jid || ''),
      gruposDoContrato: grupos,
      sessao,
      buscarGrupo: (jid) => wuzapiService.baixarInfoGrupo(jid),
      telefonesAutorizados: autorizados,
      log: logSeguro,
    });
    res.status(resultado.status).json(resultado.body);
  } catch (error: unknown) {
    console.error(`[Wuzapi] ${redigirTelefones(redigirSegredos(error instanceof Error ? error.message : 'falha'))}`);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao listar participantes' });
  }
}

export async function criarLoteHttp(req: Request, res: Response): Promise<void> {
  try {
    const resultado = await autorizarPessoasEmLote({
      role: req.usuario?.role,
      contractIdUsuario: req.usuario?.contractId,
      contractId: String(req.params.id || '').trim(),
      body: req.body,
      log: logSeguro,
    });
    res.status(resultado.status).json(resultado.body);
  } catch (error: unknown) {
    console.error(`[Wuzapi] ${redigirTelefones(redigirSegredos(error instanceof Error ? error.message : 'falha'))}`);
    if (!res.headersSent) res.status(500).json({ error: mensagemErroLotePublica(error) });
  }
}
