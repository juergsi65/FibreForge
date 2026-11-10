export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
};

export type User = {
  id: number;
  username: string;
  is_admin: number;
  is_active: number;
  can_edit: number;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: User | null };
};
