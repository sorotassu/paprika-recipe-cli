# paprika-recipe-cli

> **⚠️ Unofficial CLI for Paprika Recipe Manager**  
> Not affiliated with or endorsed by Hindsight Labs LLC.

A command-line interface for [Paprika Recipe Manager](https://www.paprikaapp.com). Access your recipes, meal plans, and grocery lists from the terminal.

## Installation

```bash
npm install -g paprika-recipe-cli
```

Or run directly with npx:

```bash
npx paprika-recipe-cli --help
```

## Quick Start

```bash
# Authenticate (interactive)
paprika auth

# List your recipes
paprika recipes

# Search for a recipe
paprika search "chicken"

# View a recipe
paprika recipe "Pasta Carbonara"

# Import a recipe from JSON
paprika import-recipe ./recipe.json --dry-run
paprika import-recipe ./recipe.json

# Check sync counts
paprika status

# Check your grocery list
paprika groceries
```

## Commands

### Authentication

```bash
paprika auth              # Interactive login
paprika logout            # Clear stored credentials
paprika whoami            # Show current user
```

### Read-only Utilities

```bash
paprika status           # Show sync object counts
paprika status --json

paprika bookmarks        # List saved bookmarks
paprika bookmarks --json
```

### Recipes

```bash
paprika recipes                        # List all recipes
paprika recipes --category "Dinner"    # Filter by category
paprika recipes --json                 # Output as JSON

paprika recipe "Pasta Carbonara"       # View by name
paprika recipe <uid>                   # View by UID
paprika recipe "Pasta" --ingredients-only
paprika recipe "Pasta" --json

paprika search "chicken"               # Search recipes
paprika search "quick dinner" --json

paprika import-recipe ./recipe.json                # Create from JSON
paprika import-recipe ./recipe.json --dry-run      # Validate only
paprika import-recipe ./recipe.json --update-existing
paprika import-recipe ./recipe.json --allow-duplicate

paprika update-recipe "Pasta Carbonara" ./recipe.json
paprika update-recipe <uid> ./recipe.json --dry-run

paprika favorite-recipe "Pasta Carbonara"
paprika favorite-recipe "Pasta Carbonara" --remove

paprika pin-recipe "Pasta Carbonara"
paprika pin-recipe "Pasta Carbonara" --remove

paprika trash-recipe "Pasta Carbonara" --dry-run
paprika restore-recipe "Pasta Carbonara" --dry-run
```

### Meal Planning

```bash
paprika meals                   # Show all planned meals (includes meal UIDs)
paprika meals --date 2026-01-08 # Filter by date
paprika meals --json

paprika add-meal 2026-01-08 dinner "Leftovers"
paprika add-meal 2026-01-08 dinner --recipe "Pasta Carbonara"
paprika add-meal 2026-01-08 2 --recipe <recipe-uid> --dry-run

paprika update-meal <meal-uid> --type lunch --date 2026-01-09
paprika update-meal <meal-uid> --recipe "Soup"
paprika update-meal <meal-uid> --name "Takeout"

paprika remove-meal <meal-uid>
paprika remove-meal <meal-uid> --dry-run

paprika menus                   # List menus
paprika menus --json

paprika menuitems               # List menu items
paprika menuitems --json
```

### Groceries

```bash
paprika groceries                       # Show unpurchased items (includes item UIDs)
paprika groceries --all                 # Include purchased items
paprika groceries --json

paprika add-grocery "Red onions"
paprika add-grocery "Broth" "2 cartons" --aisle "Canned and Jar Goods"
paprika add-grocery "Garlic" --dry-run --json

paprika update-grocery <grocery-uid> --quantity "3 cloves"
paprika update-grocery <grocery-uid> --aisle Produce --name "Green onions"

paprika check-grocery <grocery-uid>
paprika uncheck-grocery <grocery-uid>

paprika remove-grocery <grocery-uid>
paprika remove-grocery <grocery-uid> --dry-run
```

### Pantry

```bash
paprika pantry          # List pantry items
paprika pantry --json
```

### Categories

```bash
paprika categories                         # List all categories (includes UIDs)
paprika categories --json

paprika create-category "Weeknight"
paprika create-category "Noodles" --parent "Main Courses"
paprika create-category "Scratch" --dry-run --json

paprika rename-category "Weeknight" "Quick Weeknight"
paprika rename-category <category-uid> --parent "Main Courses"
paprika rename-category <category-uid> --parent none

paprika delete-category "Quick Weeknight"
paprika delete-category <category-uid> --dry-run
```

## Options

Global flags available on all commands:

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help |
| `-V, --version` | Show version number |
| `--no-color` | Disable colored output |
| `--json` | Output as JSON (where applicable) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PAPRIKA_EMAIL` | Email for authentication |
| `PAPRIKA_PASSWORD` | Password for authentication |
| `NO_COLOR` | Disable colored output (any value) |

For non-interactive use (scripts, CI/CD), set both `PAPRIKA_EMAIL` and `PAPRIKA_PASSWORD` environment variables.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Generic failure |
| `2` | Invalid usage (bad arguments) |
| `3` | Authentication failure |

## Examples

### Export all recipes to JSON

```bash
paprika recipes --json > my-recipes.json
```

### Import a recipe from JSON

```bash
paprika import-recipe ./recipe.json --dry-run
paprika import-recipe ./recipe.json
```

Recipe imports accept a single recipe object or an array of recipe objects. Category values may be existing Paprika category names or UUIDs.

`update-recipe` expects a single recipe object and preserves the target recipe UID while applying fields from the JSON file.

`trash-recipe` and `restore-recipe` are the supported deletion lifecycle. Permanent deletion and fresh local photo upload are intentionally not implemented yet because the Paprika API behavior for those paths is not verified.

### Get ingredients for a recipe

```bash
paprika recipe "Spaghetti" --ingredients-only
```

### Script: Check if a recipe exists

```bash
if paprika recipe "Lasagna" --json > /dev/null 2>&1; then
  echo "Recipe found!"
fi
```

### View this week's meal plan

```bash
# Get meals for a specific date
paprika meals --date $(date +%Y-%m-%d)
```

## API Client

This package also exports a TypeScript client for programmatic use:

```typescript
import { generateSyncHash, PaprikaClient } from 'paprika-recipe-cli';

const client = new PaprikaClient({
  email: process.env.PAPRIKA_EMAIL,
  password: process.env.PAPRIKA_PASSWORD,
});

const status = await client.getStatus();
const bookmarks = await client.getBookmarks();
const recipes = await client.getAllRecipes();
const mealTypes = await client.getMealTypes();
const meals = await client.getMeals();
const menus = await client.getMenus();
const menuItems = await client.getMenuItems();
const groceryLists = await client.getGroceryLists();
const groceryAisles = await client.getGroceryAisles();
const groceries = await client.getGroceries();
const categories = await client.getCategories();
const pantry = await client.getPantry();
await client.saveMeals([
  {
    uid: "22222222-2222-2222-2222-222222222222",
    recipe_uid: null,
    name: "Example Dinner",
    date: "2026-01-08 00:00:00",
    type: 2,
    order_flag: 0,
    hash: generateSyncHash(),
    deleted: false,
  },
]);
await client.saveGroceries([
  {
    uid: "33333333-3333-3333-3333-333333333333",
    name: "Broth",
    ingredient: "Broth",
    recipe_uid: null,
    recipe: null,
    instruction: "",
    quantity: "2 cartons",
    purchased: false,
    order_flag: 0,
    separate: false,
    aisle: groceryAisles[0]?.name ?? "",
    aisle_uid: groceryAisles[0]?.uid ?? null,
    list_uid: groceryLists[0]!.uid,
    hash: generateSyncHash(),
    deleted: false,
  },
]);
await client.saveCategories([
  {
    uid: "44444444-4444-4444-4444-444444444444",
    name: "Example Category",
    order_flag: 0,
    parent_uid: categories[0]?.uid ?? null,
    hash: generateSyncHash(),
    deleted: false,
  },
]);
const saved = await client.saveRecipe({
  uid: "11111111-1111-1111-1111-111111111111",
  name: "Example Recipe",
  description: "",
  ingredients: "1 cup broth",
  directions: "Heat and serve.",
  notes: "",
  nutritional_info: "",
  servings: "1",
  difficulty: "Easy",
  prep_time: "",
  cook_time: "",
  total_time: "",
  source: "",
  source_url: "",
  image_url: null,
  photo: "",
  photo_hash: "",
  photo_large: null,
  scale: null,
  hash: "",
  categories: [],
  rating: 0,
  in_trash: false,
  is_pinned: false,
  on_favorites: false,
  created: "2026-01-01 00:00:00",
  deleted: false,
});
```

## Development

```bash
git clone https://github.com/mjrussell/paprika-recipe-cli
cd paprika-recipe-cli
npm install
npm run build
node dist/cli.js --help
```

## License

MIT © [Matt Russell](https://github.com/mjrussell)

## Disclaimer

This is an unofficial tool created by the community. Paprika Recipe Manager is a trademark of Hindsight Labs LLC. This project is not affiliated with, endorsed by, or connected to Hindsight Labs LLC in any way.

Requires a Paprika Recipe Manager account with cloud sync enabled.
