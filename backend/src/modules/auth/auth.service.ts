import { env } from "../../config/env.js";
import type { User } from "../../generated/prisma/client.js";
import { prisma } from "../../infra/prisma.js";
import type { AuthenticatedUser } from "./auth.types.js";
import type { GoogleProfile } from "./google-oauth.client.js";

export function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isAdmin: env.ADMIN_EMAILS.includes(user.email.toLowerCase()),
  };
}

export async function findUserById(userId: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function upsertGoogleUser(profile: GoogleProfile): Promise<{ user: User; isNewUser: boolean }> {
  const existing = await prisma.user.findUnique({
    where: { googleSub: profile.googleSub },
    select: { id: true },
  });
  const user = await prisma.user.upsert({
    where: { googleSub: profile.googleSub },
    create: {
      googleSub: profile.googleSub,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    },
    update: {
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      lastLoginAt: new Date(),
    },
  });
  return { user, isNewUser: existing === null };
}
