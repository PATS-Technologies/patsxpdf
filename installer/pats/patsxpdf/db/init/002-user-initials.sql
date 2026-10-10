ALTER TABLE app_user ADD COLUMN IF NOT EXISTS initials VARCHAR(3);

WITH names AS (
  SELECT id, regexp_split_to_array(trim(name), '\s+') AS words
  FROM app_user
  WHERE initials IS NULL OR trim(initials) = ''
)
UPDATE app_user AS users
SET initials = upper(CASE
  WHEN cardinality(names.words) = 1 THEN substr(names.words[1], 1, 3)
  WHEN cardinality(names.words) = 2 THEN substr(names.words[1], 1, 2) || substr(names.words[2], 1, 1)
  ELSE substr(names.words[1], 1, 1) || substr(names.words[2], 1, 1) || substr(names.words[3], 1, 1)
END)
FROM names
WHERE users.id = names.id;

ALTER TABLE app_user ALTER COLUMN initials SET NOT NULL;