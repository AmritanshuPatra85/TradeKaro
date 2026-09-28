import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/verifyToken";

export interface AuthedRequest extends Request {
  userId?: string;
  isGuest?: boolean;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const user = await verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  req.userId = user.userId;
  req.isGuest = user.isGuest;
  next();
}
