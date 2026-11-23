# People

## TLDR

Someone the work involves: a teammate, a customer contact, an agent's human. One record per person, linked from projects and meetings.

Records are one file per thing (`<id>.md`), with frontmatter. Create and update them with `record_save` (type `person`); read one and everything it links to with `record_get person/<id>`. Link to other records with `[[type/id]]`. Prefer updating the record over writing a new note about the same thing.

`brainium lint` flags person records missing required fields (role), broken links, and live records nobody has touched in 30 days or that are past `review_by`.
