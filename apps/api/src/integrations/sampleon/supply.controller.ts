/**
 * /api/v1/s2s/supply/* — called by SAMPLEON (and, for the card feed, the panel websites).
 * Public as far as user sessions go; every request must carry a valid service signature.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Caller, ForModule, Public, type Ctx } from '../../common/context';
import { authenticateS2s } from './s2s';
import { SupplyService } from './supply.service';

type RawReq = Request & { rawBody?: Buffer };

@Controller('s2s/supply')
export class SupplyController {
  constructor(private s: SupplyService) {}

  @Public() @Get('attributes')
  attributes(@Req() req: RawReq) { authenticateS2s(req, ['sampleon']); return this.s.attributes(); }

  @Public() @Post('eligibility/count') @HttpCode(200)
  count(@Req() req: RawReq, @Body() b: unknown) { authenticateS2s(req, ['sampleon']); return this.s.count(b); }

  @Public() @Post('eligibility/select') @HttpCode(200)
  select(@Req() req: RawReq, @Body() b: unknown) { authenticateS2s(req, ['sampleon']); return this.s.select(b); }

  @Public() @Post('eligibility/check') @HttpCode(200)
  check(@Req() req: RawReq, @Body() b: unknown) { authenticateS2s(req, ['sampleon']); return this.s.check(b); }

  @Public() @Post('deliveries') @HttpCode(200)
  deliver(@Req() req: RawReq, @Body() b: unknown) { authenticateS2s(req, ['sampleon']); return this.s.deliver(b); }

  @Public() @Get('panel/:panel/cards')
  cards(@Req() req: RawReq, @Param('panel') panel: string, @Query('respondentRef') ref: string) {
    const caller = authenticateS2s(req, ['sampleon', 'panel']);
    return this.s.cards(panel, String(ref ?? ''), caller);
  }

  @Public() @Post('events') @HttpCode(200)
  events(@Req() req: RawReq, @Body() b: unknown) { authenticateS2s(req, ['sampleon']); return this.s.receive(b); }
}

/** Signed-in staff: what SAMPLEON has done with this workspace's panelists. */
@ForModule('panels')
@Controller('panels/sampleon')
export class SupplyOverviewController {
  constructor(private s: SupplyService) {}
  @Get('overview')
  overview(@Caller() ctx: Ctx) { return this.s.overview(ctx.tenantId); }
}
