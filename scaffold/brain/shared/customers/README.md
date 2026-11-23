# Customers

## TLDR

An organisation you work with. Link its people, projects and meetings.

Records are one file per thing (`<id>.md`), with frontmatter. Create and update them with `record_save` (type `customer`); read one and everything it links to with `record_get customer/<id>`. Link to other records with `[[type/id]]`. Prefer updating the record over writing a new note about the same thing.

`brainium lint` flags customer records missing required fields (status), broken links, and live records nobody has touched in 30 days or that are past `review_by`.
