import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { config } from '../common/config';
import { Caller, Public, type Ctx } from '../common/context';
import { parse } from '../common/zod';
import { AuthService } from './auth.service';

/** Sign-in attempts per IP per minute (override with LOGIN_RATE_LIMIT, e.g. in tests). */
const loginLimit = () => Number(process.env.LOGIN_RATE_LIMIT ?? 10);

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1).max(200), tenant: z.string().optional(), returnToken: z.boolean().optional() });
const MfaBody = z.object({ challenge: z.string(), code: z.string().regex(/^\d{6}$/), returnToken: z.boolean().optional() });

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  private setCookie(res: Response, token: string, expiresAt: Date) {
    res.cookie(config.cookieName, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires: expiresAt, path: '/' });
  }

  @Public()
  @Throttle({ default: { limit: loginLimit, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parse(LoginBody, body);
    const r = await this.auth.login(b.email, b.password, b.tenant);
    if (r.mfaRequired) return r;
    this.setCookie(res, r.token, r.expiresAt);
    // Browsers use the httpOnly cookie; API clients ask for a Bearer token explicitly.
    return { mfaRequired: false, expiresAt: r.expiresAt, ...(b.returnToken ? { token: r.token } : {}) };
  }

  @Public()
  @Throttle({ default: { limit: loginLimit, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(200)
  async verify(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parse(MfaBody, body);
    const r = await this.auth.verifyMfa(b.challenge, b.code);
    this.setCookie(res, r.token, r.expiresAt);
    return { mfaRequired: false, expiresAt: r.expiresAt, ...(b.returnToken ? { token: r.token } : {}) };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Caller() ctx: Ctx, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx);
    res.clearCookie(config.cookieName, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@Caller() ctx: Ctx) {
    return this.auth.me(ctx);
  }

  @Post('mfa/enroll')
  enroll(@Caller() ctx: Ctx) {
    return this.auth.enrollMfa(ctx);
  }

  @Post('mfa/activate')
  @HttpCode(200)
  activate(@Caller() ctx: Ctx, @Body() body: unknown) {
    return this.auth.activateMfa(ctx, parse(z.object({ code: z.string().regex(/^\d{6}$/) }), body).code);
  }
}
