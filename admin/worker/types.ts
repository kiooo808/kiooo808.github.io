export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  LOCAL_DEMO?: string;
  PUBLISH_PAUSED?: string;
  OWNER_LOGIN: string;
  OWNER_ID?: string;
  REPOSITORY: string;
  SITE_URL: string;
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_PRIVATE_KEY?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  PUBLIC_ORIGIN?: string;
}
export type Publication = {
  action?: string;
  target_key?: string;
  trash_id?: string;
  result?: string | null;
  id: string;
  draft_id: string;
  version: number;
  attempt: number;
  status: string;
  payload: string;
  before_payload: string | null;
  branch: string | null;
  head: string | null;
  base_head: string | null;
  pr: number | null;
  merge_sha: string | null;
  error: string | null;
  created: string;
  updated: string;
};
export const activeStates = ["queued", "checking", "deploying", "verifying"];
export function demo(env: Env, url: URL) {
  return (
    env.LOCAL_DEMO === "true" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}
export const now = () => new Date().toISOString();
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
