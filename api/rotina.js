// Rotina automática da agenda (confirmações e desmarcações).
// Chamada a cada minuto pelo agendador do banco (pg_cron do Supabase) com o cabeçalho x-rotina-token.
import { banco, garantirEsquema } from '../lib/banco.js';
import { tokenIgual } from '../lib/seguranca.js';
import { executarRotina } from '../lib/confirmacao.js';
import { executarRegrasAutomaticasHoje } from '../lib/campanhas.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const autorizado = tokenIgual(req.headers['x-rotina-token'], process.env.ROTINA_TOKEN) ||
    (process.env.CRON_SECRET && tokenIgual(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`));
  if (!autorizado) return res.status(401).json({ erro: 'Não autorizado' });
  try {
    await garantirEsquema();
    // configuração única: o próprio banco (pg_cron do Supabase) passa a chamar esta rotina a cada minuto,
    // sem depender do computador da paróquia
    if (req.query.agendar === '1') {
      const sql = banco();
      const url = `https://${req.headers.host}/api/rotina?origem=pg_cron`;
      const cabecalhos = JSON.stringify({ 'x-rotina-token': process.env.ROTINA_TOKEN });
      await sql`create extension if not exists pg_cron`;
      await sql`create extension if not exists pg_net`;
      await sql`select cron.unschedule(jobid) from cron.job where jobname = 'rotina-confirmacoes'`;
      const comando = `select net.http_get(url := '${url.replace(/'/g, "''")}', headers := '${cabecalhos.replace(/'/g, "''")}'::jsonb)`;
      await sql`select cron.schedule('rotina-confirmacoes', '* * * * *', ${comando})`;
      return res.status(200).json({ ok: true, agendado: true });
    }

    // NOTA DE RECONSTRUÇÃO: o corpo desta chamada regular (o que de fato roda a cada
    // minuto) foi cortado pela API de leitura da Vercel e foi reescrito aqui chamando
    // executarRotina() diretamente — ver lib/confirmacao.js para o aviso de reconstrução
    // dessa lógica.
    const resultado = await executarRotina(String(req.query.origem || ''));
    const lembretes = await executarRegrasAutomaticasHoje().catch((e) => {
      console.error('[rotina] regras automáticas', e);
      return { enfileiradas: 0 };
    });
    return res.status(200).json({ ok: true, ...resultado, lembretesEnfileirados: lembretes.enfileiradas });
  } catch (e) {
    console.error('[rotina]', e);
    return res.status(500).json({ erro: e.message });
  }
}
