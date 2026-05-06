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
```

### Meal Planning

```bash
paprika meals                   # Show all planned meals
paprika meals --date 2026-01-08 # Filter by date
paprika meals --json

paprika menus                   # List menus
paprika menus --json

paprika menuitems               # List menu items
paprika menuitems --json
```

### Groceries

```bash
paprika groceries        # Show unpurchased items
paprika groceries --all  # Include purchased items
paprika groceries --json
```

### Pantry

```bash
paprika pantry          # List pantry items
paprika pantry --json
```

### Categories

```bash
paprika categories       # List all categories
paprika categories --json
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
import { PaprikaClient } from 'paprika-recipe-cli';

const client = new PaprikaClient({
  email: process.env.PAPRIKA_EMAIL,
  password: process.env.PAPRIKA_PASSWORD,
});

const status = await client.getStatus();
const bookmarks = await client.getBookmarks();
const recipes = await client.getAllRecipes();
const meals = await client.getMeals();
const menus = await client.getMenus();
const menuItems = await client.getMenuItems();
const groceries = await client.getGroceries();
const pantry = await client.getPantry();
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
