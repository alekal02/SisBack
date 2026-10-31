import { Request, Response } from 'express';
import AppDataSource from '../database/data-source';
import { Contract } from '../entities/Contract';
import { Servico } from '../entities/Servico';
import { ehGestorGlobal } from '../middlewares/authMiddleware';
import { invalidarCachePainel } from '../services/painelCache';
import {
  calcularCicloMensalContrato,
  inferirMesReferenciaAtual,
} from '@sistemma/shared';
import { obterPainelContrato, obterPainelDiretoria } from '../services/painelDiretoriaService';

function preco(valor: unknown): number | null {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function cicloInicio(diaInicio: number): string {
  const dia = diaInicio || 1;
  const ref = inferirMesReferenciaAtual(dia);
  return calcularCicloMensalContrato(ref.ano, ref.mes, dia).dataInicio;
}

export class PainelDiretoriaController {
  async diretoria(req: Request, res: Response): Promise<void> {
    try {
      if (!ehGestorGlobal(req.usuario) || req.usuario?.contractId) {
        res.status(403).json({ error: 'Painel da diretoria é do gestor' });
        return;
      }
      const payload = await obterPainelDiretoria();
      res.json(payload);
    } catch (err) {
      console.error('[painel] diretoria:', (err as Error)?.message || err);
      res.status(500).json({ error: 'Não foi possível montar o painel' });
    }
  }

  async contrato(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id || '');
      const payload = await obterPainelContrato(id);
      if (!payload) {
        res.status(404).json({ error: 'Contrato não encontrado' });
        return;
      }
      res.json(payload);
    } catch (err) {
      console.error('[painel] contrato:', (err as Error)?.message || err);
      res.status(500).json({ error: 'Não foi possível montar a visão financeira' });
    }
  }

  async lerMetas(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id || '');
      const contract = await AppDataSource.getRepository(Contract).findOne({ where: { id } });
      if (!contract) {
        res.status(404).json({ error: 'Contrato não encontrado' });
        return;
      }
      const inicio = cicloInicio(Number(contract.diaInicioCiclo) || 1);
      const servicos = await AppDataSource.getRepository(Servico).find({
        where: { contract_id: id },
        order: { nome: 'ASC' },
      });
      let meta: { meta_faturamento?: unknown; metas_producao?: Record<string, number> } | undefined;
      try {
        const rows = await AppDataSource.query(
          `SELECT meta_faturamento, metas_producao FROM meta_ciclo
           WHERE contrato_id = $1 AND ciclo_inicio = $2`,
          [id, inicio],
        );
        meta = rows?.[0];
      } catch {
        meta = undefined;
      }
      const ref = inferirMesReferenciaAtual(Number(contract.diaInicioCiclo) || 1);
      const ciclo = calcularCicloMensalContrato(ref.ano, ref.mes, Number(contract.diaInicioCiclo) || 1);
      res.json({
        cicloInicio: inicio,
        cicloLabel: ciclo.label,
        metaFaturamento: preco(meta?.meta_faturamento),
        metasProducao: meta?.metas_producao || {},
        contrato: {
          valorTonelada: preco(contract.valorTonelada),
          valorMini: preco(contract.valorMini),
          valorTruck: preco(contract.valorTruck),
          valorToco: preco(contract.valorToco),
          valorBasculante: preco(contract.valorBasculante),
        },
        servicos: servicos.map((s) => ({
          id: s.id,
          nome: s.nome,
          tipo: s.tipo,
          configFaturamento: s.configFaturamento || null,
        })),
      });
    } catch (err) {
      console.error('[painel] metas:', (err as Error)?.message || err);
      res.status(500).json({ error: 'Não foi possível ler metas e preços' });
    }
  }

  async salvarMetas(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id || '');
      const contract = await AppDataSource.getRepository(Contract).findOne({ where: { id } });
      if (!contract) {
        res.status(404).json({ error: 'Contrato não encontrado' });
        return;
      }
      const body = req.body || {};
      const inicio = String(body.cicloInicio || cicloInicio(Number(contract.diaInicioCiclo) || 1));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) {
        res.status(400).json({ error: 'Ciclo inválido' });
        return;
      }
      const campos = ['valorTonelada', 'valorMini', 'valorTruck', 'valorToco', 'valorBasculante'] as const;
      if (body.contrato && typeof body.contrato === 'object') {
        for (const campo of campos) {
          if (body.contrato[campo] !== undefined) {
            contract[campo] = preco(body.contrato[campo]);
          }
        }
        await AppDataSource.getRepository(Contract).save(contract);
      }
      if (Array.isArray(body.servicos)) {
        const repo = AppDataSource.getRepository(Servico);
        for (const item of body.servicos) {
          if (!item?.id) continue;
          const servico = await repo.findOne({ where: { id: String(item.id), contract_id: id } });
          if (!servico || !item.configFaturamento || typeof item.configFaturamento !== 'object') continue;
          const atual = (servico.configFaturamento || {}) as Record<string, unknown>;
          const patch = item.configFaturamento as Record<string, unknown>;
          const junto = { ...atual, ...patch };
          const tem = ['valorTonelada', 'valorMini', 'valorTruck', 'valorToco', 'valorBasculante', 'valorM2', 'valorM2Manual', 'valorM2Mecanizada', 'valorKmLinear', 'valorPorArvore', 'valorPorEquipe', 'valorPorUnidade']
            .some((k) => preco(junto[k]) != null);
          servico.configFaturamento = { ...junto, ativo: tem };
          await repo.save(servico);
        }
      }
      const metaFaturamento = body.metaFaturamento === undefined ? undefined : preco(body.metaFaturamento);
      const metasProducao = body.metasProducao && typeof body.metasProducao === 'object'
        ? body.metasProducao
        : {};
      await AppDataSource.query(
        `INSERT INTO meta_ciclo (contrato_id, ciclo_inicio, meta_faturamento, metas_producao, atualizado_em)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (contrato_id, ciclo_inicio)
         DO UPDATE SET meta_faturamento = EXCLUDED.meta_faturamento,
                       metas_producao = EXCLUDED.metas_producao,
                       atualizado_em = now()`,
        [id, inicio, metaFaturamento ?? null, JSON.stringify(metasProducao)],
      );
      invalidarCachePainel();
      await this.lerMetas(req, res);
    } catch (err) {
      console.error('[painel] salvar metas:', (err as Error)?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'Não foi possível gravar metas e preços' });
    }
  }
}
