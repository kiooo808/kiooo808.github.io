ALTER TABLE drafts ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN action TEXT NOT NULL DEFAULT 'publish';
ALTER TABLE publications ADD COLUMN target_key TEXT;
ALTER TABLE publications ADD COLUMN trash_id TEXT;
ALTER TABLE publications ADD COLUMN result TEXT;
CREATE UNIQUE INDEX publication_active_content ON publications(target_key) WHERE target_key IS NOT NULL AND status IN ('queued','checking','deploying','verifying');
CREATE TABLE trash (id TEXT PRIMARY KEY, content_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, assets TEXT NOT NULL DEFAULT '[]', created TEXT NOT NULL, was_published INTEGER NOT NULL);
CREATE TABLE media_links (draft_id TEXT NOT NULL, media_id TEXT NOT NULL, PRIMARY KEY(draft_id,media_id));
INSERT OR IGNORE INTO media_links SELECT draft_id,id FROM media;
