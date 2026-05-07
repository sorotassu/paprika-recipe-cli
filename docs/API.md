# Paprika API Surface

This documents which Paprika cloud sync endpoints this CLI uses, what
behavior has been verified against the live service, and what remains
uncertain or intentionally unsupported.

Base URL: `https://www.paprikaapp.com/api/v2`

Authentication: Bearer JWT obtained from
`https://www.paprikaapp.com/api/v1/account/login/`. The CLI stores only
`email` + `token` and forces re-authentication on token rejection.

## Verified read endpoints

These return predictable shapes and are exercised by built-in CLI commands.

| Endpoint                  | CLI command        | Notes                                                            |
| ------------------------- | ------------------ | ---------------------------------------------------------------- |
| `/sync/status/`           | `paprika status`   | Returns counts for all syncable entity types.                    |
| `/sync/recipes/`          | `paprika recipes`  | Returns `{ uid, hash }` stubs; full recipes via per-UID fetch.   |
| `/sync/recipe/<uid>/`     | `paprika recipe`   | Returns a fully populated recipe document.                       |
| `/sync/categories/`       | `paprika categories` | Includes `parent_uid` for hierarchy.                           |
| `/sync/bookmarks/`        | `paprika bookmarks` | URL bookmarks (separate from recipes).                          |
| `/sync/meals/`            | `paprika meals`    | Meal plan entries; `type` is integer index, `type_uid` UUID.     |
| `/sync/mealtypes/`        | _(internal)_       | Used by `add-meal`/`update-meal` to resolve type names.          |
| `/sync/grocerylists/`     | _(internal)_       | Default list resolution helper.                                  |
| `/sync/groceryaisles/`    | _(internal)_       | Aisle resolution for grocery commands.                           |
| `/sync/groceries/`        | `paprika groceries`| Per-list grocery items.                                          |
| `/sync/pantry/`           | `paprika pantry`   | Pantry entries, optional ingredient/aisle metadata.              |
| `/sync/menus/`            | `paprika menus`    | Menu metadata only.                                              |
| `/sync/menuitems/`        | `paprika menuitems`| Menu item rows (read-only in this CLI).                          |

## Verified write endpoints

List-style writes go through `PaprikaClient.saveEntities()`, which encodes a
gzip-compressed JSON array in a `multipart/form-data` `data` field. Recipe
writes use the same gzip multipart transport at `/sync/recipe/<uid>/`, with an
optional `photo_upload` file part for local photo replacement.

| Endpoint               | CLI helpers                                                         | Validation                                                                          |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/sync/recipe/<uid>/`  | `import-recipe`, `import-url`, `update-recipe`, `trash-recipe`, `restore-recipe`, `favorite-recipe`, `pin-recipe` | Live import + readback + reversible lifecycle updates on disposable test recipes.   |
| `/sync/recipe/<uid>/`  | `delete-recipe`                                                     | Live disposable recipe posted with `deleted: true` vanished from `/sync/recipes/` and later `GET /sync/recipe/<uid>/` returned `Recipe not found.` |
| `/sync/recipe/<uid>/`  | `set-recipe-photo`                                                  | Live upload + replacement verified with `photo_upload` file part and recipe JSON carrying `photo=<filename>`, `photo_large=""`, `photo_hash=""`, `image_url=null`. |
| `/sync/categories/`    | `create-category`, `rename-category`, `delete-category`             | Live create → re-parent → child + parent delete cycle.                              |
| `/sync/bookmarks/`     | `add-bookmark`, `update-bookmark`, `remove-bookmark`                | Live add → re-read → update by title → delete cycle.                                |
| `/sync/meals/`         | `add-meal`, `update-meal`, `remove-meal`                            | Live add → re-read → update date/type/recipe → delete cycle.                        |
| `/sync/groceries/`     | `add-grocery`, `update-grocery`, `check-grocery`, `uncheck-grocery`, `remove-grocery` | Live add → update aisle/quantity → check → uncheck → delete cycle.                  |

## Uncertain / unsupported

These are tracked but not exposed as commands until the behavior is
verified against live data.

| Area                            | Status                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/bookmarklet/v1/recipe/` scrape | Intentionally not used. Requires browser-rendered `styles` payload (computed CSS + DOM geometry). `import-url` parses pages directly via schema.org JSON-LD instead. |
| Pantry writes                   | Not implemented. Endpoint shape is read-only here; write payload not yet probed.                                                                                |
| Menu and menu item writes       | Not implemented. `POST /sync/menuitems/` rejected meal-shaped payloads in early probes; correct write shape unverified.                                         |

## Sync request shape

Verified writes use this shape:

- `Content-Type: multipart/form-data`
- form field `data`: `gzip(JSON.stringify(payload))` as `application/octet-stream`
- list endpoints (`/sync/bookmarks/`, `/sync/meals/`, `/sync/groceries/`, `/sync/categories/`) send JSON arrays and are handled by `PaprikaClient.saveEntities()`
- recipe endpoint (`/sync/recipe/<uid>/`) sends a single JSON object; local photo updates add `photo_upload` as a second multipart file part
- response: `{ "result": true }` on success, `{ "error": { code, message } }` on failure

Read responses come back gzip-compressed JSON in the form
`{ "result": <body> }`. Authentication errors (`401`/`403`, or
auth-shaped error messages) trigger a forced reauth in `PaprikaClient`.
