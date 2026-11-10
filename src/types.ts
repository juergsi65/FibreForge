export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  NOMINATIM_COUNTRY?: string;
};

export type User = {
  id: number;
  username: string;
  is_admin: number;
  is_active: number;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: User | null };
};
