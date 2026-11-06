import type { EngineEvent } from '../shared/types';

export interface BatchJob { id: string; ok?: boolean; error?: string; tries?: number }

/**
 * Fila de projetos com concorrência configurável (padrão 1: uma GPU / um harness por vez).
 * `retries`: no fim da fila, refaz os projetos que falharam (retomando do cache: o que já saiu não é refeito),
 * para um lote deixado rodando sozinho não perder vídeos por um erro intermitente do modelo.
 */
export class BatchRunner {
  private cancelled = false;
  private cancelOne?: (id: string) => void;
  constructor(
    private runOne: (id: string) => Promise<{ ok: boolean; error?: string }>,
    private emit: (e: EngineEvent) => void,
    cancelOne?: (id: string) => void,
  ) { this.cancelOne = cancelOne; }

  async run(ids: string[], concurrency = 1, retries = 0): Promise<BatchJob[]> {
    const jobs: BatchJob[] = ids.map((id) => ({ id }));
    const running = new Set<string>();
    let done = 0, failed = 0;
    this.cancelled = false;
    const update = (finished = false) =>
      this.emit({ t: 'batch.update', total: ids.length, done, failed, running: [...running], finished });
    update();
    const pass = async (queue: BatchJob[]) => {
      let next = 0;
      const worker = async () => {
        while (!this.cancelled && next < queue.length) {
          const job = queue[next++]!;
          running.add(job.id); update();
          job.tries = (job.tries ?? 0) + 1;
          try {
            const r = await this.runOne(job.id);
            job.ok = r.ok; job.error = r.error;
          } catch (e) { job.ok = false; job.error = (e as Error).message; }
          running.delete(job.id);
          if (job.tries === 1) done++;
          if (job.ok && job.tries > 1) failed--;
          else if (!job.ok && job.tries === 1) failed++;
          update();
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, worker));
    };
    await pass(jobs);
    for (let r = 1; r <= retries && !this.cancelled; r++) {
      const again = jobs.filter((j) => !j.ok);
      if (!again.length) break;
      this.emit({ t: 'log', line: `lote: refazendo ${again.length} projeto(s) que falharam (rodada ${r}/${retries}, continua de onde parou): ${again.map((j) => j.id).join(', ')}` });
      await pass(again);
    }
    update(true);
    return jobs;
  }

  cancel(activeIds: string[] = []) {
    this.cancelled = true;
    for (const id of activeIds) this.cancelOne?.(id);
  }
}
