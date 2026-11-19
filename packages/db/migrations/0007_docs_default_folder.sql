-- Decision 039: newly linked repos show docs/ by default. Rows on the 0006 default ("" = whole repo)
-- go back to docs; production had no linked repos when 0006 ran, so no one chose "" on purpose.
UPDATE `workspace_repos` SET `docs_path` = 'docs' WHERE `docs_path` = '';
