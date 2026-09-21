CREATE TYPE "public"."work_item_kind" AS ENUM('epic', 'story', 'task');--> statement-breakpoint
CREATE TYPE "public"."work_item_priority" AS ENUM('none', 'low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."work_item_status" AS ENUM('backlog', 'draft', 'refinement', 'in_review', 'ready', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
ALTER TABLE "proposal" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
-- Existing workflow summaries map onto the smaller status model without losing rows.
ALTER TABLE "proposal" ALTER COLUMN "status" SET DATA TYPE "public"."work_item_status" USING (
  CASE "status"::text
    WHEN 'draft' THEN 'draft'
    WHEN 'refinement' THEN 'refinement'
    WHEN 'in_review' THEN 'in_review'
    WHEN 'changes_requested' THEN 'in_review'
    WHEN 'approved' THEN 'ready'
    WHEN 'delivery_review' THEN 'ready'
    WHEN 'ready' THEN 'ready'
    WHEN 'published' THEN 'done'
    WHEN 'obsolete' THEN 'cancelled'
    ELSE 'draft'
  END
)::"public"."work_item_status";--> statement-breakpoint
ALTER TABLE "proposal" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "key" text;--> statement-breakpoint
-- Derive a key from the product name (first letters of words, then letters), and
-- de-duplicate within the organization with a numeric suffix.
WITH candidates AS (
  SELECT id,
    organization_id,
    COALESCE(
      NULLIF(
        CASE
          WHEN array_length(regexp_split_to_array(trim(name), '\s+'), 1) > 1
            THEN LEFT(REGEXP_REPLACE(UPPER(REGEXP_REPLACE(name, '[^A-Za-z0-9 ]', '', 'g')), '(\w)\w*\s*', '\1', 'g'), 4)
          ELSE LEFT(UPPER(REGEXP_REPLACE(name, '[^A-Za-z0-9]', '', 'g')), 4)
        END,
        ''
      ),
      'PRD'
    ) AS base,
    ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS ordinal
  FROM product
)
UPDATE product p SET key = (
  CASE
    WHEN c.base ~ '^[A-Z][A-Z0-9]{1,9}$' AND (SELECT COUNT(*) FROM candidates o WHERE o.organization_id = c.organization_id AND o.base = c.base) = 1 THEN c.base
    WHEN c.base ~ '^[A-Z]' THEN LEFT(c.base, 1) || 'P' || c.ordinal::text
    ELSE 'P' || c.ordinal::text
  END
) FROM candidates c WHERE c.id = p.id;--> statement-breakpoint
ALTER TABLE "product" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "parent_id" text;--> statement-breakpoint
-- Existing proposals were feature-level; they become Epics. New items default to Story.
ALTER TABLE "proposal" ADD COLUMN "kind" "work_item_kind" DEFAULT 'epic' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal" ALTER COLUMN "kind" SET DEFAULT 'story';--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "number" integer;--> statement-breakpoint
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY organization_id, product_id ORDER BY created_at, id) AS n FROM proposal
)
UPDATE proposal p SET number = numbered.n FROM numbered WHERE numbered.id = p.id;--> statement-breakpoint
ALTER TABLE "proposal" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "priority" "work_item_priority" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "detail" jsonb;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "work_item_parent_fk" FOREIGN KEY ("organization_id","product_id","parent_id") REFERENCES "public"."proposal"("organization_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_parent_idx" ON "proposal" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE INDEX "work_item_assignee_idx" ON "proposal" USING btree ("organization_id","assignee_id");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_org_key_unique" UNIQUE("organization_id","key");--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "work_item_product_number_unique" UNIQUE("organization_id","product_id","number");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_key_format" CHECK ("product"."key" ~ '^[A-Z][A-Z0-9]{1,9}$');--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "work_item_not_own_parent" CHECK ("proposal"."parent_id" IS NULL OR "proposal"."parent_id" <> "proposal"."id");--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "work_item_positive_number" CHECK ("proposal"."number" > 0);--> statement-breakpoint
-- Legacy free-text activity actions become the structured `legacy` action.
UPDATE activity SET detail = jsonb_build_object('text', action), action = 'legacy' WHERE detail IS NULL;--> statement-breakpoint
DROP TYPE "public"."proposal_status";
