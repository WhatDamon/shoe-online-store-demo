CREATE TABLE IF NOT EXISTS "ai_budget_days" (
	"day" text PRIMARY KEY NOT NULL,
	"reserved_tokens" integer DEFAULT 0 NOT NULL,
	"used_tokens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_budget_reservations" (
	"request_id" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"reserved_tokens" integer NOT NULL,
	"actual_tokens" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"session_key" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_embeddings" (
	"product_id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"vector" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text NOT NULL,
	"description" text NOT NULL,
	"price_amount" double precision NOT NULL,
	"currency" text NOT NULL,
	"product_type" text NOT NULL,
	"collections" text NOT NULL,
	"sizes" text NOT NULL,
	"colors" text NOT NULL,
	"features" text NOT NULL,
	"tags" text NOT NULL,
	"construction" text NOT NULL,
	"visual" text NOT NULL,
	"images" text NOT NULL,
	"fit_notes" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "products_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_budget_reservations_day" ON "ai_budget_reservations" USING btree ("day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_budget_reservations_recovery" ON "ai_budget_reservations" USING btree ("status","created_at","request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_usage_day" ON "ai_usage" USING btree ("day");
