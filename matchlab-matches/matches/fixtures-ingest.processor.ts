import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { FixturesIngestService } from './fixtures-ingest.service';
import { MatchesService } from './matches.service';

export const FIXTURES_QUEUE = 'fixtures';
export const FIXTURES_INGEST_JOB = 'ingest-fixtures';

/**
 * Фоновое обновление расписания.
 *
 * Периодичность задаётся при регистрации повторяющейся задачи (см. модуль).
 * Источник обновляет файл расписания несколько раз в неделю, поэтому смысла
 * ходить к нему чаще раза в час нет.
 */
@Processor(FIXTURES_QUEUE)
export class FixturesIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(FixturesIngestProcessor.name);

  constructor(
    private readonly ingest: FixturesIngestService,
    private readonly matches: MatchesService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== FIXTURES_INGEST_JOB) {
      return undefined;
    }

    try {
      const result = await this.ingest.ingest();
      // Кэш ответов сбрасывается только после успешной загрузки: если источник
      // недоступен, пусть лучше отдаются прежние данные, чем пустой блок.
      await this.matches.invalidateCache();
      return result;
    } catch (e) {
      this.logger.error(
        `не удалось обновить расписание: ${(e as Error).message}`,
        (e as Error).stack,
      );
      throw e;
    }
  }
}
