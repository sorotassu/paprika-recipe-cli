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

All writes go through `PaprikaClient.saveEntities()`, which encodes a
gzip-compressed JSON array in a `multipart/form-data` `data` field. Each
payload uses a fresh `hash` and `deleted` flag for soft-delete semantics.

| Endpoint               | CLI helpers                                                         | Validation                                                                          |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/sync/recipe/<uid>/`  | `import-recipe`, `import-url`, `update-recipe`, lifecycle helpers   | Live import + readback + trash on disposable test recipes.                          |
| `/sync/categories/`    | `create-category`, `rename-category`, `delete-category`             | Live create → re-parent → child + parent delete cycle.                              |
| `/sync/bookmarks/`     | `add-bookmark`, `update-bookmark`, `remove-bookmark`                | Live add → re-read → update by title → delete cycle.                                |
| `/sync/meals/`         | `add-meal`, `update-meal`, `remove-meal`                            | Live add → re-read → update date/type/recipe → delete cycle.                        |
| `/sync/groceries/`     | `add-grocery`, `update-grocery`, `check-grocery`, `uncheck-grocery`, `remove-grocery` | Live add → update aisle/quantity → check → uncheck → delete cycle.                  |

## Uncertain / unsupported

These are tracked but not exposed as commands until the behavior is
verified against live data.

| Area                            | Status                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permanent recipe delete         | Not exposed. Live `deleted: true` semantics on `/sync/recipe/<uid>/` not yet validated; trash/restore is the supported deletion path. Tracked in issue #9.      |
| Fresh local recipe photo upload | Not exposed. `clone_recipe()` evidence in third-party clients shows multipart `photo_upload` part; CLI cannot yet generate that payload safely. Tracked in #9.  |
| `/bookmarklet/v1/recipe/` scrape | Intentionally not used. Requires browser-rendered `styles` payload (computed CSS + DOM geometry). `import-url` parses pages directly via schema.org JSON-LD instead. |
| Pantry writes                   | Not implemented. Endpoint shape is read-only here; write payload not yet probed.                                                                                |
| Menu and menu item writes       | Not implemented. `POST /sync/menuitems/` rejected meal-shaped payloads in early probes; correct write shape unverified.                                         |

## Sync request shape

Verified writes use this shape (handled internally by
`PaprikaClient.saveEntities`):

- `Content-Type: multipart/form-data`
- form field `data`: `gzip(JSON.stringify(items))` as `application/octet-stream`
- response: `{ "result": true }` on success, `{ "error": { code, message } }` on failure

Read responses come back gzip-compressed JSON in the form
`{ "result": <body> }`. Authentication errors (`401`/`403`, or
auth-shaped error messages) trigger a forced reauth in `PaprikaClient`.
