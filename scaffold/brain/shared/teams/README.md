# Teams

## TLDR

A group of people and agents. Link its members and the projects it owns.

Records are one file per thing (`<id>.md`), with frontmatter. Create and update them with `record_save` (type `team`); read one and everything it links to with `record_get team/<id>`. Link to other records with `[[type/id]]`. Prefer updating the record over writing a new note about the same thing.

`brainium lint` flags team records missing required fields, broken links, and live records nobody has touched in 30 days or that are past `review_by`.
