# Meetings

## TLDR

A meeting worth remembering: one record each, linked to its project and people so notes are one hop away.

Records are one file per thing (`<id>.md`), with frontmatter. Create and update them with `record_save` (type `meeting`); read one and everything it links to with `record_get meetings/<id>`. Link to other records with `[[folder/id]]`, e.g. `[[people/sam]]` (Obsidian resolves this form too; `[[person/sam]]` also works in Brainium). Prefer updating the record over writing a new note about the same thing.

`brainium lint` flags meeting records missing required fields (date), broken links, and live records nobody has touched in 30 days or that are past `review_by`.
