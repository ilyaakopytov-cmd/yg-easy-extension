export type YouGileUser = {
  id: string;
  email?: string;
  realName?: string;
};

export type UsersResponse = {
  content: YouGileUser[];
};

export function getUserDisplayName(user: YouGileUser): string {
  const realName = user.realName?.trim();
  const email = user.email?.trim();

  if (realName && realName !== email) {
    return realName;
  }

  if (email) {
    return email;
  }

  return user.id;
}
