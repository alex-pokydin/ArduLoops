-- The vehicle profile: facts about the airframe the board cannot report (props, cells, weight, how it flies).
-- JSON next to the note in `comment`; empty until the profile is first saved.
ALTER TABLE controllers ADD COLUMN profile TEXT NOT NULL DEFAULT '';
