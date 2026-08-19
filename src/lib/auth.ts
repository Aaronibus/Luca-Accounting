// Session auth (JWT cookie) + company-scoped authorisation.
// Every data access goes through requireCompany(), which resolves the user's
// membership and role for the active company — organisation isolation is
// enforced here and in the engine (accounts are validated per company).

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db, tables } from "@/db";
import { and, eq } from "drizzle-orm";
import { Role, Capability, roleCan } from "@/lib/types";
import { listUserCompanies } from "@/lib/services/companies";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? "luca-dev-secret");
const COOKIE = "luca_session";
const COMPANY_COOKIE = "luca_company";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET);
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 3600,
    path: "/",
  });
}

export function destroySession() {
  cookies().delete(COOKIE);
  cookies().delete(COMPANY_COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const userId = payload.sub;
    if (!userId) return null;
    const user = db
      .select({ id: tables.users.id, email: tables.users.email, name: tables.users.name })
      .from(tables.users)
      .where(eq(tables.users.id, userId))
      .get();
    return user ?? null;
  } catch {
    return null;
  }
}

export class AuthError extends Error {
  constructor(message: string, public status: number = 401) {
    super(message);
  }
}

/** Thrown when a signed-in user has no company yet — the app routes them to onboarding. */
export class NoCompanyError extends Error {
  constructor() {
    super("No company yet");
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthError("Not signed in", 401);
  return user;
}

export interface CompanyContext {
  user: SessionUser;
  companyId: string;
  company: typeof tables.companies.$inferSelect;
  role: Role;
  can: (cap: Capability) => boolean;
}

export function setActiveCompany(companyId: string) {
  cookies().set(COMPANY_COOKIE, companyId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 90 * 24 * 3600 });
}

/** Companies the user belongs to (excluding archived unless asked). */
export function userCompanies(userId: string, opts?: { includeArchived?: boolean }) {
  return listUserCompanies(userId, opts);
}

/**
 * Resolve the active company for the signed-in user and verify membership.
 * Throws if the user has no access — this is the tenancy boundary.
 */
export async function requireCompany(requiredCap?: Capability): Promise<CompanyContext> {
  const user = await requireUser();
  let companyId = cookies().get(COMPANY_COOKIE)?.value;

  // Verify the cookie still points at a company this user can access; otherwise
  // fall back to their first company. This is the tenancy boundary — a forged or
  // stale cookie can never grant access to another tenant's data.
  if (companyId) {
    const ok = db
      .select({ id: tables.memberships.id })
      .from(tables.memberships)
      .where(and(eq(tables.memberships.userId, user.id), eq(tables.memberships.companyId, companyId)))
      .get();
    if (!ok) companyId = undefined;
  }

  if (!companyId) {
    const memberships = listUserCompanies(user.id);
    if (memberships.length === 0) throw new NoCompanyError();
    companyId = memberships[0].companyId;
  }

  const membership = db
    .select()
    .from(tables.memberships)
    .where(and(eq(tables.memberships.userId, user.id), eq(tables.memberships.companyId, companyId)))
    .get();
  if (!membership) throw new AuthError("You do not have access to this company", 403);

  const company = db.select().from(tables.companies).where(eq(tables.companies.id, companyId)).get();
  if (!company) throw new AuthError("Company not found", 404);

  const role = membership.role as Role;
  if (requiredCap && !roleCan(role, requiredCap)) {
    throw new AuthError(`Your role (${role.toLowerCase()}) cannot perform this action`, 403);
  }

  return { user, companyId, company, role, can: (cap) => roleCan(role, cap) };
}
