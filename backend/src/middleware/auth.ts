import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthRequest extends Request {
  user?: { id: string };
}

/**
 * The calendar day where the client is, as `YYYY-MM-DD`, or undefined.
 *
 * Sent by the browser on every request. The server has no other way to know
 * which day it is for the reader, and billing a subscription on the server's
 * UTC day charges people in the Americas hours before their local midnight.
 * Treated as a hint: the charger clamps it to ±1 day of the server's own.
 */
export function clientDay(req: Request): string | undefined {
  const raw = req.headers['x-client-day'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  jwt.verify(token, config.jwtSecret, (err: any, user: any) => {
    if (err) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    req.user = user;
    next();
  });
};
