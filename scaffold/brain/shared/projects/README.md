# Projects

## TLDR

A piece of work with an owner and an end. Link the people, team, customers and documents it involves.

Records are one file per thing (`<id>.md`), with frontmatter. Create and update them with `record_save` (type `project`); read one and everything it links to with `record_get project/<id>`. Link to other records with `[[type/id]]`. Prefer updating the record over writing a new note about the same thing.

`brainium lint` flags project records missing required fields (status, owner), broken links, and live records nobody has touched in 30 days or that are past `review_by`.
