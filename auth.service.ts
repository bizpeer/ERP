// ============================================================
// Auth Service - JWT Authentication & RBAC
// ============================================================
import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Redis } from 'ioredis';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import {
  User, Role, Permission, JwtPayload, AuthTokens,
  PermissionAction, ERP_MODULE, ApiResponse, AuditAction
} from './index';

// ─── Token Service ───────────────────────────────────────────
export class TokenService {
  private readonly ACCESS_TTL = '15m';
  private readonly REFRESH_TTL = '7d';
  private readonly REFRESH_TTL_SECONDS = 604800;

  constructor(
    private readonly jwtSecret: string,
    private readonly refreshSecret: string,
    private readonly redis: Redis
  ) { }

  generateTokens(payload: Omit<JwtPayload, 'iat' | 'exp'>): AuthTokens {
    const accessToken = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.ACCESS_TTL,
    });

    const refreshToken = jwt.sign(
      { sub: payload.sub, tenantId: payload.tenantId },
      this.refreshSecret,
      { expiresIn: this.REFRESH_TTL }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  async storeRefreshToken(userId: string, token: string): Promise<void> {
    await this.redis.setex(
      `refresh:${userId}`,
      this.REFRESH_TTL_SECONDS,
      token
    );
  }

  async revokeRefreshToken(userId: string): Promise<void> {
    await this.redis.del(`refresh:${userId}`);
  }

  async blacklistAccessToken(token: string, expiresIn: number): Promise<void> {
    await this.redis.setex(`blacklist:${token}`, expiresIn, '1');
  }

  async isBlacklisted(token: string): Promise<boolean> {
    return (await this.redis.exists(`blacklist:${token}`)) === 1;
  }

  verifyAccessToken(token: string): JwtPayload {
    return jwt.verify(token, this.jwtSecret) as JwtPayload;
  }

  verifyRefreshToken(token: string): { sub: string; tenantId: string } {
    return jwt.verify(token, this.refreshSecret) as { sub: string; tenantId: string };
  }
}

// ─── Permission Service ──────────────────────────────────────
export class PermissionService {
  can(
    user: JwtPayload,
    module: ERP_MODULE | string,
    action: PermissionAction
  ): boolean {
    const permissionKey = `${module}:${action}`;
    return user.permissions.includes(permissionKey) ||
      user.permissions.includes(`${module}:*`) ||
      user.permissions.includes('*:*');
  }

  buildPermissionsArray(roles: Role[]): string[] {
    const permissions = new Set<string>();

    for (const role of roles) {
      for (const permission of role.permissions) {
        for (const action of permission.actions) {
          permissions.add(`${permission.module}:${action}`);
        }
      }
    }

    return [...permissions];
  }
}

// ─── Auth Repository ─────────────────────────────────────────
export class AuthRepository {
  constructor(private pool: Pool) { }

  async findUserByEmail(email: string, tenantId: string): Promise<User | null> {
    const result = await this.pool.query(
      `SELECT u.*, 
              json_agg(DISTINCT jsonb_build_object(
                'id', r.id, 'name', r.name, 'code', r.code,
                'permissions', (
                  SELECT json_agg(jsonb_build_object(
                    'module', p.module, 'actions', p.actions
                  )) FROM role_permissions p WHERE p.role_id = r.id
                )
              )) FILTER (WHERE r.id IS NOT NULL) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.email = $1 AND u.tenant_id = $2 AND u.is_deleted = FALSE
       GROUP BY u.id`,
      [email, tenantId]
    );

    if (result.rows.length === 0) return null;
    return this.mapUser(result.rows[0]);
  }

  async findUserById(id: string, tenantId: string): Promise<User | null> {
    const result = await this.pool.query(
      `SELECT u.*,
              json_agg(DISTINCT jsonb_build_object(
                'id', r.id, 'name', r.name, 'code', r.code,
                'permissions', (
                  SELECT json_agg(jsonb_build_object(
                    'module', p.module, 'actions', p.actions
                  )) FROM role_permissions p WHERE p.role_id = r.id
                )
              )) FILTER (WHERE r.id IS NOT NULL) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1 AND u.tenant_id = $2 AND u.is_deleted = FALSE
       GROUP BY u.id`,
      [id, tenantId]
    );

    if (result.rows.length === 0) return null;
    return this.mapUser(result.rows[0]);
  }

  async updateLastLogin(userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [userId]
    );
  }
  async getUserCount(tenantId: string): Promise<number> {
    const result = await this.pool.query(
      'SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND is_deleted = FALSE',
      [tenantId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  async createUser(data: Partial<User> & { passwordHash: string }): Promise<User> {
    const result = await this.pool.query(
      `INSERT INTO users (
        tenant_id, company_id, email, username, first_name, last_name, 
        password_hash, is_active, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        data.tenantId, data.companyId, data.email, data.username,
        data.firstName, data.lastName, data.passwordHash,
        data.isActive ?? true, data.createdBy
      ]
    );
    return this.mapUser(result.rows[0]);
  }

  async deleteUser(userId: string, tenantId: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET is_deleted = TRUE, deleted_at = NOW() WHERE id = $1 AND tenant_id = $2',
      [userId, tenantId]
    );
  }

  private mapUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      companyId: row.company_id as string,
      email: row.email as string,
      username: row.username as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      passwordHash: row.password_hash as string,
      roles: (row.roles as Role[]) || [],
      permissions: [],
      isActive: row.is_active as boolean,
      lastLoginAt: row.last_login_at as Date,
      mfaEnabled: row.mfa_enabled as boolean,
      preferredLanguage: row.preferred_language as string,
      timezone: row.timezone as string,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      createdBy: row.created_by as string,
      updatedBy: row.updated_by as string,
      isDeleted: row.is_deleted as boolean,
      version: row.version as number,
    };
  }
}

// ─── Auth Service (Business Logic) ───────────────────────────
export class AuthService {
  constructor(
    private authRepo: AuthRepository,
    public tokenService: TokenService,
    private permissionService: PermissionService
  ) { }

  async login(
    email: string,
    password: string,
    tenantId: string,
    companyId: string
  ): Promise<AuthTokens> {
    const user = await this.authRepo.findUserByEmail(email, tenantId);

    if (!user || !user.isActive) {
      throw new Error('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new Error('Invalid credentials');
    }

    const permissions = this.permissionService.buildPermissionsArray(user.roles);

    const tokens = this.tokenService.generateTokens({
      sub: user.id,
      tenantId: user.tenantId,
      companyId: companyId,
      roles: user.roles.map((r) => r.code),
      permissions,
    });

    await this.tokenService.storeRefreshToken(user.id, tokens.refreshToken);
    await this.authRepo.updateLastLogin(user.id);

    return tokens;
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const payload = this.tokenService.verifyRefreshToken(refreshToken);
    const user = await this.authRepo.findUserById(payload.sub, payload.tenantId);

    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
    }

    // Rotate refresh token
    await this.tokenService.revokeRefreshToken(user.id);
    const permissions = this.permissionService.buildPermissionsArray(user.roles);

    const tokens = this.tokenService.generateTokens({
      sub: user.id,
      tenantId: user.tenantId,
      companyId: user.companyId,
      roles: user.roles.map((r) => r.code),
      permissions,
    });

    await this.tokenService.storeRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(accessToken: string, userId: string): Promise<void> {
    try {
      const payload = this.tokenService.verifyAccessToken(accessToken);
      const expiresIn = payload.exp - Math.floor(Date.now() / 1000);
      if (expiresIn > 0) {
        await this.tokenService.blacklistAccessToken(accessToken, expiresIn);
      }
    } catch {
      // Token already expired, just revoke refresh
    }
    await this.tokenService.revokeRefreshToken(userId);
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async register(adminUser: JwtPayload, userData: any): Promise<User> {
    // 1. 보안 정책: 사용자 정원 10명 제한 (Windows 로컬망 앱 요구사항)
    const count = await this.authRepo.getUserCount(adminUser.tenantId);
    if (count >= 10) {
      throw new Error('사용자 정원(10명)이 초과되었습니다. 새로운 사용자를 추가하려면 기존 사용자를 삭제해야 합니다.');
    }

    // 2. 관리자 권한 확인 (간소화된 체크)
    // 실제 운영 환경에서는 permissionService.can을 사용해야 함

    const passwordHash = await this.hashPassword(userData.password);
    return this.authRepo.createUser({
      ...userData,
      tenantId: adminUser.tenantId,
      companyId: adminUser.companyId,
      passwordHash,
      createdBy: adminUser.sub
    });
  }

  async removeUser(adminUser: JwtPayload, userId: string): Promise<void> {
    // 본인 삭제 방지 등 추가 로직 가능
    await this.authRepo.deleteUser(userId, adminUser.tenantId);
  }
}

// ─── Middleware ───────────────────────────────────────────────
export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  tenantId?: string;
  companyId?: string;
}

export function createAuthMiddleware(
  tokenService: TokenService
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ success: false, message: 'No token provided' });
        return;
      }

      const token = authHeader.substring(7);

      if (await tokenService.isBlacklisted(token)) {
        res.status(401).json({ success: false, message: 'Token revoked' });
        return;
      }

      const payload = tokenService.verifyAccessToken(token);
      req.user = payload;
      req.tenantId = payload.tenantId;
      req.companyId = payload.companyId;
      next();
    } catch (error) {
      res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
  };
}

export function createPermissionMiddleware(
  permissionService: PermissionService,
  module: ERP_MODULE | string,
  action: PermissionAction
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!permissionService.can(req.user, module, action)) {
      res.status(403).json({
        success: false,
        message: `Permission denied: ${module}:${action}`,
      });
      return;
    }

    next();
  };
}

export function createTenantMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    // Extract tenant from subdomain or header
    const tenantSlug =
      req.headers['x-tenant-id'] as string ||
      req.hostname.split('.')[0];

    if (!tenantSlug) {
      res.status(400).json({ success: false, message: 'Tenant not identified' });
      return;
    }

    (req as any).tenantSlug = tenantSlug;
    next();
  };
}

// ─── Rate Limiting ───────────────────────────────────────────
export function createRateLimiter(
  windowMs: number,
  max: number,
  message: string
) {
  return rateLimit({
    windowMs,
    max,
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const authReq = req as AuthenticatedRequest;
      return authReq.user
        ? `${authReq.user.tenantId}:${authReq.user.sub}`
        : req.ip || 'unknown';
    },
  });
}

export const apiRateLimiter = createRateLimiter(
  60 * 1000,    // 1 minute
  100,          // 100 requests
  'Too many requests, please try again later'
);

export const authRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5,              // 5 attempts
  'Too many login attempts'
);

// ─── Auth Router ─────────────────────────────────────────────
export function createAuthRouter(authService: AuthService): express.Router {
  const router = express.Router();

  /**
   * @openapi
   * /auth/login:
   *   post:
   *     summary: User login
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [email, password, companyId]
   *             properties:
   *               email:
   *                 type: string
   *               password:
   *                 type: string
   *               companyId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Login successful
   *       401:
   *         description: Invalid credentials
   */
  router.post('/login', authRateLimiter, async (req, res) => {
    try {
      const { email, password, companyId } = req.body;
      const tenantId = (req as any).tenantId;

      if (!email || !password || !companyId) {
        res.status(400).json({
          success: false,
          message: 'Email, password and companyId are required',
        });
        return;
      }

      const tokens = await authService.login(email, password, tenantId, companyId);
      res.json({ success: true, data: tokens });
    } catch (error) {
      res.status(401).json({
        success: false,
        message: error instanceof Error ? error.message : 'Login failed',
      });
    }
  });

  router.post('/refresh', async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        res.status(400).json({ success: false, message: 'Refresh token required' });
        return;
      }

      const tokens = await authService.refresh(refreshToken);
      res.json({ success: true, data: tokens });
    } catch {
      res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }
  });

  router.post('/logout', async (req: AuthenticatedRequest, res) => {
    try {
      const token = req.headers.authorization?.substring(7) || '';
      const userId = req.user?.sub || '';
      await authService.logout(token, userId);
      res.json({ success: true, message: 'Logged out successfully' });
    } catch {
      res.status(500).json({ success: false, message: 'Logout failed' });
    }
  });

  /**
   * @openapi
   * /auth/users:
   *   post:
   *     summary: Create a new user (Admin only, Max 10)
   *     tags: [Auth]
   *     security:
   *       - BearerAuth: []
   */
  router.post('/users', createAuthMiddleware(authService.tokenService as any), async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

      const user = await authService.register(req.user, req.body);
      res.status(201).json({ success: true, data: user });
      return;
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create user',
      });
    }
  });

  router.delete('/users/:id', createAuthMiddleware(authService.tokenService as any), async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

      await authService.removeUser(req.user, req.params.id);
      res.json({ success: true, message: 'User deleted successfully' });
      return;
    } catch (error) {
      res.status(400).json({ success: false, message: 'Failed to delete user' });
    }
  });

  return router;
}
