# Documents

## TLDR

A spec, plan, brief or policy that lives here (or a pointer to one that lives elsewhere). Set review_by so it can't quietly go stale.

Records are one file per thing (`<id>.md`), with frontmatter. Create and update them with `record_save` (type `document`); read one and everything it links to with `record_get document/<id>`. Link to other records with `[[type/id]]`. Prefer updating the record over writing a new note about the same thing.

`brainium lint` flags document records missing required fields (status), broken links, and live records nobody has touched in 30 days or that are past `review_by`.
