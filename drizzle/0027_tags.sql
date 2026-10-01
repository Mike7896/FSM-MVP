CREATE TABLE tags (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name text NOT NULL CONSTRAINT tags_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 40),
 color text NOT NULL DEFAULT 'blue' CONSTRAINT tags_color_check CHECK (color IN ('slate','blue','violet','pink','red','orange','amber','green','teal'))
);
CREATE UNIQUE INDEX tags_org_name_unique ON tags(organization_id, lower(name));
CREATE TABLE tag_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
 quote_id uuid REFERENCES documents(id) ON DELETE CASCADE,
 customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
 CONSTRAINT tag_assignment_one_target CHECK (num_nonnulls(job_id, quote_id, customer_id) = 1)
);
CREATE UNIQUE INDEX tag_job_unique ON tag_assignments(job_id,tag_id);
CREATE UNIQUE INDEX tag_quote_unique ON tag_assignments(quote_id,tag_id);
CREATE UNIQUE INDEX tag_customer_unique ON tag_assignments(customer_id,tag_id);
CREATE INDEX tag_assignments_org_idx ON tag_assignments(organization_id);
CREATE INDEX tag_assignments_tag_idx ON tag_assignments(tag_id);
--> statement-breakpoint
-- Preserve tenant and quote-type integrity even for writes outside the API.
CREATE FUNCTION public.tag_assignment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM tags WHERE id = NEW.tag_id AND organization_id = NEW.organization_id)
 OR (NEW.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs WHERE id = NEW.job_id AND organization_id = NEW.organization_id))
 OR (NEW.quote_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.quote_id AND organization_id = NEW.organization_id AND type = 'quote'))
 OR (NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id = NEW.customer_id AND organization_id = NEW.organization_id)) THEN
 RAISE EXCEPTION 'Tag and target must belong to the same organization and target must be a supported object.' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tag_assignment_guard BEFORE INSERT OR UPDATE ON tag_assignments FOR EACH ROW EXECUTE FUNCTION public.tag_assignment_guard();
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags: members read" ON tags FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "tag_assignments: members read" ON tag_assignments FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
