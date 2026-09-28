import { listTags, tagsForRecords } from "@/lib/queries/tags";
import type { TagEntity } from "@/lib/tags";
import { RecordTags } from "./tag-controls";

export async function RecordTagSection({
  organizationId,
  entity,
  recordId,
}: {
  organizationId: string;
  entity: TagEntity;
  recordId: string;
}) {
  const [available, selected] = await Promise.all([
    listTags(organizationId),
    tagsForRecords(organizationId, entity, [recordId]),
  ]);
  return (
    <RecordTags
      organizationId={organizationId}
      entity={entity}
      recordId={recordId}
      available={available}
      selected={selected[recordId] ?? []}
    />
  );
}
