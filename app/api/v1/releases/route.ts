import { requireCaller } from "@/lib/api/auth";
import { handler } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { listReleases } from "@/lib/release-notes/service";

export const GET = handler(async request => {
  await requireCaller(request);
  return ok((await listReleases()).map(({ version, publishedAt }) => ({ version, publishedAt })));
});
