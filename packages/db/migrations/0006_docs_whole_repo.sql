-- Decision 038: a linked repo shows its whole tree unless an Admin picked a folder. Rows still on
-- the old default ("docs") move to the whole repo; a folder someone chose is kept.
UPDATE `workspace_repos` SET `docs_path` = '' WHERE `docs_path` = 'docs';
