import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { MatchesService } from './matches.service';
import { MatchdayQueryDto, UpcomingQueryDto } from './dto/query.dto';
import { MatchdayResponseDto, UpcomingResponseDto } from './dto/match.dto';

@ApiTags('matches')
@Controller({ path: 'matches', version: '1' })
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  /**
   * Блок «Ближайшие матчи». Один эндпоинт обслуживает два места интерфейса:
   * виджет на главной (limit 3–4) и раздел из бокового меню (limit больше).
   */
  @Get('upcoming')
  @ApiOperation({
    summary: 'Ближайшие матчи команд с высоким угловым индексом',
    description:
      'Матчи ближайших дней, где хотя бы одна команда входит в топ своей лиги ' +
      'по угловому индексу. Порядок — хронологический.',
  })
  @ApiOkResponse({ type: UpcomingResponseDto })
  getUpcoming(@Query() query: UpcomingQueryDto): Promise<UpcomingResponseDto> {
    return this.matches.getUpcoming(query.limit);
  }

  /**
   * Страница «Смотреть все»: весь игровой день по нашим пяти лигам.
   */
  @Get('matchday')
  @ApiOperation({
    summary: 'Все матчи игрового дня',
    description:
      'Все матчи топ-5 лиг за указанный день. Если в этот день матчей нет, ' +
      'отдаётся ближайший игровой день, а признак isRequestedDate становится false.',
  })
  @ApiOkResponse({ type: MatchdayResponseDto })
  getMatchday(@Query() query: MatchdayQueryDto): Promise<MatchdayResponseDto> {
    return this.matches.getMatchday(query.date);
  }
}
