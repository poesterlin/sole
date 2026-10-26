CREATE TABLE "radio_sessions" (
  "queue_id" text PRIMARY KEY NOT NULL,
  "player_id" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "cluster_ids" jsonb NOT NULL,
  "seed_uris" jsonb NOT NULL,
  "recent_uris" jsonb NOT NULL,
  "queue_item_ids" jsonb NOT NULL,
  "message" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
